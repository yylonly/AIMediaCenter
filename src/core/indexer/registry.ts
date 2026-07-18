// Multi-site aggregated search - the "search chain" from MoviePilot.
import pLimit from 'p-limit';
import { prisma } from '@/lib/prisma';
import type { Indexer, SearchQuery, TorrentInfo } from './base';
import { yts } from './yts';
import { nyaa } from './nyaa';
import { leetx } from './leetx';
import { torrentgalaxy } from './torrentgalaxy';
import { eztv } from './eztv';
import { magnetdl } from './magnetdl';
import { dmhy } from './dmhy';
import { mikan } from './mikan';
import { createNexusphpIndexer } from './nexusphp';

// Hard-coded indexers for well-known public sites.
const REGISTRY: Record<string, Indexer> = {
  'yts.gg': yts,
  'nyaa.si': nyaa,
  '1337xx.to': leetx,
  'torrentgalaxy.one': torrentgalaxy,
  'eztvx.to': eztv,
  'magnetdl.com': magnetdl,
  'share.dmhy.org': dmhy,
  'mikanani.me': mikan
};

/** In-memory cache of NexusPHP indexers built from DB Site rows. */
let nexusphpCache: Map<string, Indexer> | null = null;
let nexusphpCacheTs = 0;
const CACHE_TTL = 30_000; // 30s - pick up config changes reasonably fast

async function loadNexusphpIndexers(): Promise<Map<string, Indexer>> {
  if (nexusphpCache && Date.now() - nexusphpCacheTs < CACHE_TTL) return nexusphpCache;
  const sites = await prisma.site.findMany({ where: { publicSite: false, isActive: true } });
  const map = new Map<string, Indexer>();
  for (const s of sites) {
    map.set(s.domain, createNexusphpIndexer(s));
  }
  nexusphpCache = map;
  nexusphpCacheTs = Date.now();
  return map;
}

/** Invalidate the NexusPHP cache (call after site config changes). */
export function resetNexusphpCache() {
  nexusphpCache = null;
  nexusphpCacheTs = 0;
}

/**
 * Resolve an indexer for the given domain.
 * Checks the hard-coded public-site registry first, then falls back to
 * a dynamically-built NexusPHP indexer for private PT sites.
 */
export async function getIndexer(domain: string): Promise<Indexer | null> {
  if (REGISTRY[domain]) return REGISTRY[domain];
  const map = await loadNexusphpIndexers();
  return map.get(domain) || null;
}

/** Synchronous lookup for public sites only (no DB hit). */
export function getPublicIndexer(domain: string): Indexer | null {
  return REGISTRY[domain] || null;
}

export function listIndexers(): Indexer[] {
  return Object.values(REGISTRY);
}

/**
 * Resolve the list of sites to search, given the query's optional `sites`
 * filter. Combines DB-configured active sites with hard-coded public
 * sites (selected but not in DB). Ordered by `pri` ascending.
 *
 * Extracted so aggregatedSearch and aggregatedSearchStream stay in sync.
 */
async function resolveSearchSites(q: SearchQuery) {
  const where: { isActive: boolean; domain?: { in: string[] } } = { isActive: true };
  if (q.sites && q.sites.length > 0) {
    where.domain = { in: q.sites };
  }
  const sites = await prisma.site.findMany({ where, orderBy: { pri: 'asc' } });
  // Build a set of domains the DB says are disabled, so we can skip them
  // when synthesizing stubs for hard-coded public sites below. Without this,
  // a disabled public site (isActive=false in DB) would still be searched
  // whenever the client explicitly lists it in q.sites.
  const disabled = await prisma.site.findMany({
    where: { isActive: false },
    select: { domain: true }
  });
  const disabledSet = new Set(disabled.map((s) => s.domain));

  // Include hard-coded public sites that are selected but not in DB, but only
  // if they haven't been explicitly disabled in the DB.
  for (const domain of q.sites || []) {
    if (disabledSet.has(domain)) continue;
    if (REGISTRY[domain] && !sites.find((s) => s.domain === domain)) {
      const idx = REGISTRY[domain];
      sites.push({
        id: -1, domain, name: idx.name, url: idx.url, pri: 99,
        publicSite: true, isActive: true, proxy: false, render: false,
        limitInterval: 0, limitCount: 0, timeout: 15,
      } as typeof sites[number]);
    }
  }
  return sites;
}

/** Dedup on (normalized title + size) and sort by seeders desc. */
function dedupAndSort(flat: TorrentInfo[]): TorrentInfo[] {
  const seen = new Map<string, TorrentInfo>();
  for (const t of flat) {
    const k = t.title.replace(/\s+/g, ' ').trim().toLowerCase() + ':' + t.size;
    if (!seen.has(k)) seen.set(k, t);
  }
  const uniq = [...seen.values()];
  uniq.sort((a, b) => b.seeders - a.seeders);
  return uniq;
}

/**
 * Aggregate search across all active sites configured in DB.
 * Public sites use hard-coded indexers; private sites use NexusPHP.
 * Applies dedup (by title+size) and sorts by seeders desc.
 */
export async function aggregatedSearch(q: SearchQuery): Promise<TorrentInfo[]> {
  const sites = await resolveSearchSites(q);
  const limit = pLimit(3);
  const results = await Promise.all(
    sites.map((s) =>
      limit(async () => {
        const indexer = await getIndexer(s.domain);
        if (!indexer) return [];
        try {
          // Pass the site's proxy preference so per-site toggles take effect.
          return await indexer.search(q, { useProxy: s.proxy });
        } catch (e) {
          console.warn(`[search] ${s.domain} failed`, (e as Error).message);
          return [];
        }
      })
    )
  );
  return dedupAndSort(results.flat());
}

export interface SearchProgress {
  /** 1-based index of the site that just finished. */
  current: number;
  /** Total number of sites being searched. */
  total: number;
  /** Display name of the site that just finished. */
  site: string;
  /** Number of torrents found at this site (0 on failure). */
  found: number;
}

/**
 * Streaming variant of aggregatedSearch. Runs the same per-site search with
 * the same concurrency, but invokes `onProgress` as each site completes so the
 * caller can push progress updates to the client. Returns the final deduped +
 * sorted result list once all sites are done, or once `timeoutMs` elapses
 * (whichever comes first) - in the latter case the already-collected partial
 * results are returned so the user sees something instead of hanging.
 */
export async function aggregatedSearchStream(
  q: SearchQuery,
  onProgress?: (p: SearchProgress) => void,
  timeoutMs = 60_000
): Promise<TorrentInfo[]> {
  const sites = await resolveSearchSites(q);
  const total = sites.length;
  let done = 0;
  // Accumulates results from each site as it completes so the timeout can
  // snapshot whatever has been collected so far.
  const collected: TorrentInfo[] = [];
  const limit = pLimit(3);

  // Per-site timeout: a single slow/hung site shouldn't block the whole
  // search until the 60s global timeout. Use the site's configured `timeout`
  // (seconds, default 15) with a 20s cap so a misconfigured large value
  // can't stall everything. Resolves to [] (treated as "no results") on
  // timeout - the site still counts toward `done` for progress accuracy.
  const searchOneSite = async (s: typeof sites[number]): Promise<TorrentInfo[]> => {
    const indexer = await getIndexer(s.domain);
    if (!indexer) return [];
    const perSiteMs = Math.min((s.timeout || 15) * 1000, 20_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<TorrentInfo[]>((resolve) => {
      timer = setTimeout(() => resolve([]), perSiteMs);
    });
    try {
      // Pass the site's proxy preference so per-site toggles take effect.
      return await Promise.race([indexer.search(q, { useProxy: s.proxy }), timeoutP]);
    } catch (e) {
      console.warn(`[search] ${s.domain} failed`, (e as Error).message);
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const searchAll = Promise.all(
    sites.map((s) =>
      limit(async () => {
        const r = await searchOneSite(s);
        collected.push(...r);
        done += 1;
        onProgress?.({ current: done, total, site: s.name, found: r.length });
        return r;
      })
    )
  );

  // Snapshot of currently collected results (deduped + sorted).
  const finish = () => dedupAndSort([...collected]);
  const timeoutPromise = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs)
  );

  // Race the full search against the timeout. Either way, return the current
  // snapshot. Copy via spread so later background pushes don't mutate it.
  await Promise.race([searchAll, timeoutPromise]);
  return finish();
}
