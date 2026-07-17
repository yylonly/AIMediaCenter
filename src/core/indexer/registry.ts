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

  // Include hard-coded public sites that are selected but not in DB.
  for (const domain of q.sites || []) {
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
          return await indexer.search(q);
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
 * sorted result list once all sites are done.
 */
export async function aggregatedSearchStream(
  q: SearchQuery,
  onProgress?: (p: SearchProgress) => void
): Promise<TorrentInfo[]> {
  const sites = await resolveSearchSites(q);
  const total = sites.length;
  let done = 0;
  const limit = pLimit(3);
  const results = await Promise.all(
    sites.map((s) =>
      limit(async () => {
        const indexer = await getIndexer(s.domain);
        let found = 0;
        try {
          const r = indexer ? await indexer.search(q) : [];
          found = r.length;
          done += 1;
          onProgress?.({ current: done, total, site: s.name, found });
          return r;
        } catch (e) {
          console.warn(`[search] ${s.domain} failed`, (e as Error).message);
          done += 1;
          onProgress?.({ current: done, total, site: s.name, found: 0 });
          return [];
        }
      })
    )
  );
  return dedupAndSort(results.flat());
}
