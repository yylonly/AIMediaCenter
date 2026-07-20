// Subscribe chain: add / refresh / search / complete.
import { prisma } from '@/lib/prisma';
import { tmdbDetail } from '@/core/tmdb/client';
import { aggregatedSearch } from '@/core/indexer/registry';
import { submitDownload } from './download';
import { parseFilename } from '@/core/meta/metaVideo';
import type { TorrentInfo } from '@/core/indexer/base';

export interface AddSubscribeInput {
  tmdbid: number;
  type: 'movie' | 'tv';
  season?: number;
  username?: string;
  include?: string;
  exclude?: string;
  resolution?: string;
  quality?: string;
}

/** Create a subscription row from a TMDB id. */
export async function addSubscribe(input: AddSubscribeInput) {
  const detail = await tmdbDetail(input.tmdbid, input.type);
  if (!detail) throw new Error('TMDB lookup failed');
  const totalEp =
    input.type === 'tv'
      ? detail.seasons?.find((s) => s.season === (input.season || 1))?.episodeCount ||
        detail.totalEpisodes ||
        null
      : null;
  const exists = await prisma.subscribe.findFirst({
    where: { tmdbid: input.tmdbid, season: input.season ?? null }
  });
  if (exists) return exists;
  return prisma.subscribe.create({
    data: {
      name: detail.title,
      year: detail.year,
      type: input.type,
      tmdbid: input.tmdbid,
      imdbid: detail.imdbid,
      season: input.season ?? (input.type === 'tv' ? 1 : null),
      poster: detail.poster,
      backdrop: detail.backdrop,
      vote: detail.vote,
      description: detail.overview,
      totalEpisode: totalEp,
      lackEpisode: totalEp,
      username: input.username,
      include: input.include,
      exclude: input.exclude,
      resolution: input.resolution,
      quality: input.quality,
      state: 'R'
    }
  });
}

function matchesFilter(title: string, include?: string | null, exclude?: string | null): boolean {
  if (include) {
    const parts = include.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length && !parts.some((p) => title.toLowerCase().includes(p))) return false;
  }
  if (exclude) {
    const parts = exclude.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.some((p) => title.toLowerCase().includes(p))) return false;
  }
  return true;
}

function matchesResolution(title: string, resolution?: string | null): boolean {
  if (!resolution) return true;
  return title.toLowerCase().includes(resolution.toLowerCase());
}

/** Normalize a title for loose comparison: lowercase, strip all separators. */
function normTitle(s: string): string {
  return s.toLowerCase().replace(/[\s.\-_·:：'"]+/g, '');
}

/**
 * Loose name equality: exact match, or containment where the shorter name
 * makes up most of the longer one. The ratio guard stops generic short
 * names from matching unrelated longer titles, e.g. "Love For You" must
 * not match "Immemorial Love For You".
 */
function looseEquals(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length >= 6 && short.length / long.length >= 0.6;
}

/**
 * Relevance gate between a search result and the subscription. Without this,
 * sites that return their latest-uploads page for unmatched keywords would
 * flood the downloader with unrelated torrents (observed in production: one
 * romanized-name subscription pulled 97 random torrents).
 *
 * A result is relevant when any parsed title candidate loosely matches any
 * known name of the subscription (stored name + fresh TMDB title variants),
 * and the years agree within ±1 when both are known.
 */
function isRelevant(
  meta: ReturnType<typeof parseFilename>,
  names: Set<string>,
  sub: { year?: string | null }
): boolean {
  const candidates = [meta.cnName, meta.enName, meta.title]
    .filter((s): s is string => !!s)
    .map(normTitle);
  const hit = candidates.some((c) => c && [...names].some((n) => n && looseEquals(c, n)));
  if (!hit) return false;
  const subYear = sub.year ? Number(sub.year) : null;
  const metaYear = meta.year ? Number(meta.year) : null;
  if (subYear && metaYear && Math.abs(subYear - metaYear) > 1) return false;
  return true;
}

/** Known name variants of a subscription: stored name + fresh TMDB titles. */
function subNames(
  sub: { name: string },
  detail: { title?: string; originalTitle?: string; altTitles?: string[] } | null
): Set<string> {
  return new Set(
    [sub.name, detail?.title, detail?.originalTitle, ...(detail?.altTitles || [])]
      .filter((s): s is string => !!s)
      .map(normTitle)
  );
}

/**
 * Search each name variant (stored name + TMDB title/original/alt titles)
 * and merge, deduplicating by torrent key. Subscriptions whose stored name
 * is a romanization (e.g. "Ye Gou Gu Tou") find nothing on CN sites; the
 * original-language variant (野狗骨头) is what those sites actually carry.
 */
async function searchVariants(
  sub: { name: string; type: string },
  detail: { title?: string; originalTitle?: string; altTitles?: string[] } | null
): Promise<TorrentInfo[]> {
  const base = [
    ...new Set(
      [sub.name, detail?.title, detail?.originalTitle, ...(detail?.altTitles || [])].filter(
        (s): s is string => !!s
      )
    )
  ].slice(0, 4);
  // PT sites index torrent titles literally, usually dot-separated
  // ("Love.For.You") - a spaced query ("Love for You") misses them.
  const keywords = [
    ...new Set(base.flatMap((k) => (k.includes(' ') ? [k, k.replace(/\s+/g, '.')] : [k])))
  ].slice(0, 8);
  const seen = new Set<string>();
  const out: TorrentInfo[] = [];
  for (const kw of keywords) {
    try {
      const results = await aggregatedSearch({ keyword: kw, mtype: sub.type as any });
      for (const t of results) {
        if (seen.has(t.key)) continue;
        seen.add(t.key);
        out.push(t);
      }
    } catch (e) {
      console.warn(`[subscribe] search "${kw}" failed`, (e as Error).message);
    }
  }
  return out;
}

/**
 * Full site search for one subscription: pick torrents, hand off to downloader,
 * update state.note (downloaded episodes) and lackEpisode.
 */
async function searchOne(sub: Awaited<ReturnType<typeof prisma.subscribe.findFirstOrThrow>>) {
  const detail = sub.tmdbid ? await tmdbDetail(sub.tmdbid, sub.type as 'movie' | 'tv') : null;
  const results = await searchVariants(sub, detail);
  const filtered = results.filter(
    (t) =>
      matchesFilter(t.title, sub.include, sub.exclude) &&
      matchesResolution(t.title, sub.resolution)
  );
  // Relevance gate: only keep results whose parsed title actually matches
  // the subscription (protects against sites returning unrelated listings).
  const names = subNames(sub, detail);
  const relevant = filtered.filter((t) => isRelevant(parseFilename(t.title), names, sub));
  if (filtered.length > 0) {
    console.log(`[subscribe] ${sub.name}: ${filtered.length} hits, ${relevant.length} relevant`);
  }

  const downloadedEps = new Set<number>(sub.note ? (JSON.parse(sub.note) as number[]) : []);

  let picked = 0;
  for (const t of relevant) {
    if (sub.type === 'movie') {
      // First matching wins
      const r = await submitDownload({ torrent: t, media: detail || undefined, username: sub.username ?? undefined });
      if (r.ok) picked++;
      break;
    } else {
      // TV: parse episode from title
      const meta = parseFilename(t.title);
      if (meta.seasonBegin && sub.season && meta.seasonBegin !== sub.season) continue;
      const eps: number[] = [];
      if (meta.episodeBegin != null) {
        const end = meta.episodeEnd ?? meta.episodeBegin;
        for (let e = meta.episodeBegin; e <= end; e++) eps.push(e);
      }
      // Skip results with no parseable episode (movies, variety packs etc.)
      // and episodes already downloaded.
      if (eps.length === 0) continue;
      const newEps = eps.filter((e) => !downloadedEps.has(e));
      if (newEps.length === 0) continue;

      const r = await submitDownload({ torrent: t, media: detail || undefined, username: sub.username ?? undefined });
      if (r.ok) {
        picked++;
        for (const e of newEps) downloadedEps.add(e);
        if (sub.totalEpisode && downloadedEps.size >= sub.totalEpisode) break;
      }
    }
  }

  const lack = sub.totalEpisode ? Math.max(0, sub.totalEpisode - downloadedEps.size) : sub.lackEpisode;
  await prisma.subscribe.update({
    where: { id: sub.id },
    data: {
      note: JSON.stringify([...downloadedEps]),
      lackEpisode: lack,
      lastUpdate: new Date()
    }
  });

  // Auto-complete
  if (sub.type === 'movie' && picked > 0) {
    await completeSubscribe(sub.id);
  } else if (sub.type === 'tv' && sub.totalEpisode && downloadedEps.size >= sub.totalEpisode) {
    await completeSubscribe(sub.id);
  }
  return picked;
}

export async function searchSubscriptions(id?: number) {
  const where = id ? { id } : { state: 'R' };
  const subs = await prisma.subscribe.findMany({ where });
  let total = 0;
  for (const s of subs) {
    try {
      total += await searchOne(s);
    } catch (e) {
      console.warn(`[subscribe] search ${s.id} failed`, (e as Error).message);
    }
  }
  return total;
}

/** Search a subscription and return matching torrents WITHOUT downloading. */
export async function previewSubscription(id: number): Promise<{
  ok: boolean;
  torrents: TorrentInfo[];
  error?: string;
}> {
  const sub = await prisma.subscribe.findUnique({ where: { id } });
  if (!sub) return { ok: false, torrents: [], error: 'subscription not found' };
  try {
    const detail = sub.tmdbid ? await tmdbDetail(sub.tmdbid, sub.type as 'movie' | 'tv') : null;
    const results = await searchVariants(sub, detail);
    const names = subNames(sub, detail);
    const filtered = results.filter(
      (t) =>
        matchesFilter(t.title, sub.include, sub.exclude) &&
        matchesResolution(t.title, sub.resolution) &&
        isRelevant(parseFilename(t.title), names, sub)
    );
    return { ok: true, torrents: filtered };
  } catch (e) {
    return { ok: false, torrents: [], error: (e as Error).message };
  }
}

/** Download selected torrents for a subscription. */
export async function downloadSelected(
  id: number,
  keys: string[]
): Promise<{ ok: boolean; picked: number; skipped: number; error?: string }> {
  const sub = await prisma.subscribe.findUnique({ where: { id } });
  if (!sub) return { ok: false, picked: 0, skipped: 0, error: 'subscription not found' };
  const detail = sub.tmdbid ? await tmdbDetail(sub.tmdbid, sub.type as 'movie' | 'tv') : null;
  try {
    const results = await searchVariants(sub, detail);
    const names = subNames(sub, detail);
    const filtered = results.filter(
      (t) =>
        matchesFilter(t.title, sub.include, sub.exclude) &&
        matchesResolution(t.title, sub.resolution) &&
        isRelevant(parseFilename(t.title), names, sub)
    );
    const selected = filtered.filter((t) => keys.includes(t.key));

    let picked = 0;
    let skipped = 0;
    for (const t of selected) {
      try {
        const r = await submitDownload({ torrent: t, media: detail || undefined, username: sub.username ?? undefined });
        if (r.ok) picked++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    if (picked > 0) {
      await prisma.subscribe.update({
        where: { id: sub.id },
        data: { lastUpdate: new Date() }
      });
    }
    return { ok: true, picked, skipped };
  } catch (e) {
    return { ok: false, picked: 0, skipped: 0, error: (e as Error).message };
  }
}

export async function completeSubscribe(id: number) {
  const s = await prisma.subscribe.findUnique({ where: { id } });
  if (!s) return;
  await prisma.subscribeHistory.create({
    data: {
      name: s.name,
      year: s.year,
      type: s.type,
      tmdbid: s.tmdbid,
      season: s.season,
      poster: s.poster,
      description: s.description,
      totalEpisode: s.totalEpisode
    }
  });
  await prisma.subscribe.delete({ where: { id } });
}
