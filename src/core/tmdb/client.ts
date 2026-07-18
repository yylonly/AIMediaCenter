// TMDB client wrapper — uses `moviedb-promise`.
// Config resolved from SystemConfig.tmdb.apiKey (DB) with env fallback.
import { MovieDb } from 'moviedb-promise';
import axios from 'axios';
import { LRUCache } from 'lru-cache';
import { prisma } from '@/lib/prisma';
import { getAxiosProxyConfig, resetProxyCache } from '@/lib/proxy';

const cache = new LRUCache<string, any>({ max: 500, ttl: 60 * 60 * 1000 });

let clientPromise: Promise<MovieDb | null> | null = null;

async function loadApiKey(): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'tmdb' } });
  if (row) {
    try {
      const v = JSON.parse(row.value) as { apiKey?: string };
      if (v.apiKey) return v.apiKey;
    } catch {
      /* ignore */
    }
  }
  return process.env.TMDB_API_KEY || null;
}

export async function getTmdb(): Promise<MovieDb | null> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const key = await loadApiKey();
      if (!key) return null;
      // Apply the tmdb-scope proxy to axios defaults. axios is only used by
      // moviedb-promise in this app, so this only affects TMDB traffic.
      const proxyCfg = await getAxiosProxyConfig('tmdb');
      if (proxyCfg) axios.defaults.proxy = proxyCfg;
      else delete axios.defaults.proxy;
      return new MovieDb(key);
    })();
  }
  return clientPromise;
}

/** Reset the memoised client (call after config update). */
export function resetTmdbClient() {
  clientPromise = null;
  cache.clear();
  resetProxyCache();
}

export interface TmdbBrief {
  tmdbid: number;
  imdbid?: string;
  type: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  overview?: string;
  year?: string;
  poster?: string;
  backdrop?: string;
  vote?: number;
  totalEpisodes?: number;
  seasons?: { season: number; episodeCount: number; airDate?: string }[];
}

const IMG = 'https://image.tmdb.org/t/p/original';

export async function tmdbSearch(query: string, limit = 10): Promise<TmdbBrief[]> {
  const tmdb = await getTmdb();
  if (!tmdb) return []; // silent no-op when API key not configured
  const key = `search:${query}`;
  const cached = cache.get(key) as TmdbBrief[] | undefined;
  if (cached) return cached;
  try {
    const res = await tmdb.searchMulti({ query, include_adult: false });
    const items = (res.results || [])
      .filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && (r as any).id)
      .slice(0, limit)
      .map((r: any) => ({
        tmdbid: r.id,
        type: r.media_type as 'movie' | 'tv',
        title: r.title || r.name,
        originalTitle: r.original_title || r.original_name,
        overview: r.overview,
        year: (r.release_date || r.first_air_date || '').slice(0, 4) || undefined,
        poster: r.poster_path ? IMG + r.poster_path : undefined,
        backdrop: r.backdrop_path ? IMG + r.backdrop_path : undefined,
        vote: r.vote_average
      }));
    cache.set(key, items);
    return items;
  } catch (e) {
    console.warn('[tmdb] search failed:', (e as Error).message);
    return [];
  }
}

export async function tmdbDetail(
  tmdbid: number,
  type: 'movie' | 'tv'
): Promise<TmdbBrief | null> {
  const tmdb = await getTmdb();
  if (!tmdb) return null;
  const key = `detail:${type}:${tmdbid}`;
  const cached = cache.get(key) as TmdbBrief | undefined;
  if (cached) return cached;
  try {
    // Request zh-CN so title/overview come back in Chinese by default.
    // The manual CN-title fallback below still applies for titles TMDB
    // hasn't translated for the zh-CN locale.
    const lang = 'zh-CN';
    const append = 'images,credits,alternative_titles,translations,external_ids';
    let data: any;
    if (type === 'movie') {
      data = await tmdb.movieInfo({ id: tmdbid, language: lang, append_to_response: append });
    } else {
      data = await tmdb.tvInfo({ id: tmdbid, language: lang, append_to_response: append });
    }

    // Chinese title preference: alternative_titles CN → translations SG → original
    let cnTitle: string | undefined;
    const altTitles = data.alternative_titles?.titles || data.alternative_titles?.results || [];
    for (const a of altTitles) {
      if (a.iso_3166_1 === 'CN' && a.title) {
        cnTitle = a.title;
        break;
      }
    }
    if (!cnTitle && data.translations?.translations) {
      for (const t of data.translations.translations) {
        if ((t.iso_3166_1 === 'SG' || t.iso_3166_1 === 'CN') && t.data?.title) {
          cnTitle = t.data.title;
          break;
        }
      }
    }
    const brief: TmdbBrief = {
      tmdbid,
      imdbid: data.imdb_id || data.external_ids?.imdb_id,
      type,
      title: cnTitle || data.title || data.name,
      originalTitle: data.original_title || data.original_name,
      overview: data.overview,
      year: (data.release_date || data.first_air_date || '').slice(0, 4) || undefined,
      poster: data.poster_path ? IMG + data.poster_path : undefined,
      backdrop: data.backdrop_path ? IMG + data.backdrop_path : undefined,
      vote: data.vote_average,
      totalEpisodes: data.number_of_episodes,
      seasons: (data.seasons || []).map((s: any) => ({
        season: s.season_number,
        episodeCount: s.episode_count,
        airDate: s.air_date || undefined
      }))
    };
    cache.set(key, brief);

    // Persist to media cache
    await prisma.mediaCache.upsert({
      where: { tmdbid_type: { tmdbid, type } },
      update: { data: JSON.stringify(brief) },
      create: { tmdbid, type, data: JSON.stringify(brief) }
    });
    return brief;
  } catch (e) {
    console.warn('[tmdb] detail failed:', (e as Error).message);
    return null;
  }
}

/** Map a raw TMDB result (with media_type) to TmdbBrief. */
function mapResult(r: any): TmdbBrief {
  return {
    tmdbid: r.id,
    type: (r.media_type === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
    title: r.title || r.name,
    originalTitle: r.original_title || r.original_name,
    overview: r.overview,
    year: (r.release_date || r.first_air_date || '').slice(0, 4) || undefined,
    poster: r.poster_path ? IMG + r.poster_path : undefined,
    backdrop: r.backdrop_path ? IMG + r.backdrop_path : undefined,
    vote: r.vote_average
  };
}

/** TMDB trending - mixed movies + TV, by day or week. */
export async function tmdbTrending(
  timeWindow: 'day' | 'week' = 'week'
): Promise<TmdbBrief[]> {
  const tmdb = await getTmdb();
  if (!tmdb) return [];
  const key = `trending:${timeWindow}`;
  const cached = cache.get(key) as TmdbBrief[] | undefined;
  if (cached) return cached;
  try {
    const res = await tmdb.trending({ media_type: 'all', time_window: timeWindow });
    const items = (res.results || [])
      .filter((r: any) => (r.media_type === 'movie' || r.media_type === 'tv') && r.id)
      .slice(0, 20)
      .map(mapResult);
    cache.set(key, items);
    return items;
  } catch (e) {
    console.warn('[tmdb] trending failed:', (e as Error).message);
    return [];
  }
}

/** TMDB popular movies or TV. */
export async function tmdbPopular(
  type: 'movie' | 'tv',
  page = 1
): Promise<TmdbBrief[]> {
  const tmdb = await getTmdb();
  if (!tmdb) return [];
  const key = `popular:${type}:${page}`;
  const cached = cache.get(key) as TmdbBrief[] | undefined;
  if (cached) return cached;
  try {
    const res =
      type === 'movie'
        ? await tmdb.moviePopular({ page })
        : await tmdb.tvPopular({ page });
    const items = (res.results || [])
      .filter((r: any) => r.id)
      .slice(0, 20)
      .map((r: any) => mapResult({ ...r, media_type: type }));
    cache.set(key, items);
    return items;
  } catch (e) {
    console.warn('[tmdb] popular failed:', (e as Error).message);
    return [];
  }
}

/** TMDB top-rated movies or TV. */
export async function tmdbTopRated(
  type: 'movie' | 'tv',
  page = 1
): Promise<TmdbBrief[]> {
  const tmdb = await getTmdb();
  if (!tmdb) return [];
  const key = `toprated:${type}:${page}`;
  const cached = cache.get(key) as TmdbBrief[] | undefined;
  if (cached) return cached;
  try {
    const res =
      type === 'movie'
        ? await tmdb.movieTopRated({ page })
        : await tmdb.tvTopRated({ page });
    const items = (res.results || [])
      .filter((r: any) => r.id)
      .slice(0, 20)
      .map((r: any) => mapResult({ ...r, media_type: type }));
    cache.set(key, items);
    return items;
  } catch (e) {
    console.warn('[tmdb] topRated failed:', (e as Error).message);
    return [];
  }
}

/** Lightweight connectivity check: run a trivial multi-search to validate the API key. */
export async function testTmdb(): Promise<{ ok: boolean; error?: string }> {
  const tmdb = await getTmdb();
  if (!tmdb) return { ok: false, error: 'TMDB API Key 未配置' };
  try {
    await tmdb.searchMulti({ query: 'test', include_adult: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
