// Jellyfin adapter — refresh library + sync existing items.
import { prisma } from '@/lib/prisma';

interface JellyfinCfg {
  url: string;
  apiKey: string;
}

async function loadCfg(): Promise<JellyfinCfg | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'jellyfin' } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as JellyfinCfg;
    if (!v.url || !v.apiKey) return null;
    return v;
  } catch {
    return null;
  }
}

function authHeaders(apiKey: string) {
  return {
    'X-Emby-Authorization': `MediaBrowser Client="AIMediaCenter", Device="server", DeviceId="1", Version="0.1.0", Token="${apiKey}"`,
    'X-Emby-Token': apiKey
  };
}

/** POST /Library/Refresh — triggers a global scan (Jellyfin doesn't expose per-item refresh well). */
export async function refreshJellyfin(): Promise<boolean> {
  const cfg = await loadCfg();
  if (!cfg) return false;
  try {
    const url = cfg.url.replace(/\/$/, '') + '/Library/Refresh';
    const res = await fetch(url, { method: 'POST', headers: authHeaders(cfg.apiKey) });
    return res.ok;
  } catch (e) {
    console.warn('[jellyfin] refresh failed', (e as Error).message);
    return false;
  }
}

interface JfItem {
  Id: string;
  Name: string;
  OriginalTitle?: string;
  Type: string;
  ProductionYear?: number;
  Path?: string;
  ProviderIds?: { Tmdb?: string; Imdb?: string };
  ParentId?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
}

interface JfEpisode {
  Id: string;
  Name: string;
  Type: string;
  Path?: string;
  IndexNumber?: number;
  SeasonNumber?: number;
  Size?: number;
}

async function fetchItems(cfg: JellyfinCfg, includeItemTypes: string): Promise<JfItem[]> {
  const url = new URL(cfg.url.replace(/\/$/, '') + '/Items');
  url.searchParams.set('IncludeItemTypes', includeItemTypes);
  url.searchParams.set('Recursive', 'true');
  url.searchParams.set('Fields', 'ProviderIds,Path,OriginalTitle,ProductionYear');
  const res = await fetch(url.toString(), { headers: authHeaders(cfg.apiKey) });
  if (!res.ok) return [];
  const data = (await res.json()) as { Items?: JfItem[] };
  return data.Items || [];
}

/** Pull Movie + Series from Jellyfin into MediaServerItem cache. */
export async function syncJellyfin(): Promise<{ ok: boolean; synced: number; error?: string }> {
  const cfg = await loadCfg();
  if (!cfg) return { ok: false, synced: 0, error: 'not configured' };
  try {
    const items = [
      ...(await fetchItems(cfg, 'Movie')),
      ...(await fetchItems(cfg, 'Series'))
    ];
    let synced = 0;
    for (const it of items) {
      const tmdbid = it.ProviderIds?.Tmdb ? Number(it.ProviderIds.Tmdb) : null;
      await prisma.mediaServerItem.upsert({
        where: { server_itemId: { server: 'jellyfin', itemId: it.Id } },
        update: {
          title: it.Name,
          originalTitle: it.OriginalTitle,
          year: it.ProductionYear ? String(it.ProductionYear) : null,
          tmdbid: tmdbid ?? null,
          imdbid: it.ProviderIds?.Imdb ?? null,
          itemType: it.Type,
          path: it.Path ?? null
        },
        create: {
          server: 'jellyfin',
          library: '',
          itemId: it.Id,
          itemType: it.Type,
          title: it.Name,
          originalTitle: it.OriginalTitle,
          year: it.ProductionYear ? String(it.ProductionYear) : null,
          tmdbid: tmdbid ?? null,
          imdbid: it.ProviderIds?.Imdb ?? null,
          path: it.Path ?? null
        }
      });
      synced++;
    }
    return { ok: true, synced };
  } catch (e) {
    return { ok: false, synced: 0, error: (e as Error).message };
  }
}

/** Quick lookup: do we already have this tmdbid on Jellyfin? */
export async function hasInJellyfin(tmdbid: number): Promise<boolean> {
  const found = await prisma.mediaServerItem.findFirst({
    where: { server: 'jellyfin', tmdbid }
  });
  return !!found;
}

/** List all cached media items */
export async function listMediaItems(params?: {
  type?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: JfItem[]; total: number }> {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const where: any = { server: 'jellyfin' };
  if (params?.type) where.itemType = params.type;
  const [items, total] = await Promise.all([
    prisma.mediaServerItem.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { title: 'asc' }
    }),
    prisma.mediaServerItem.count({ where })
  ]);
  return {
    items: items.map((it) => ({
      Id: it.itemId,
      Name: it.title,
      OriginalTitle: it.originalTitle ?? undefined,
      Type: it.itemType,
      ProductionYear: it.year ? Number(it.year) : undefined,
      Path: it.path ?? undefined,
      ProviderIds: { Tmdb: it.tmdbid ? String(it.tmdbid) : undefined, Imdb: it.imdbid ?? undefined },
      ParentId: undefined
    })),
    total
  };
}

/** Delete a media item from Jellyfin by itemId */
export async function deleteMediaItem(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadCfg();
  if (!cfg) return { ok: false, error: 'not configured' };
  try {
    const url = cfg.url.replace(/\/$/, '') + `/Items/${encodeURIComponent(itemId)}`;
    const res = await fetch(url, { method: 'DELETE', headers: authHeaders(cfg.apiKey) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    // Also remove from cache
    await prisma.mediaServerItem.deleteMany({
      where: { server: 'jellyfin', itemId }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Fetch episodes for a parent series */
export async function fetchEpisodes(parentId: string): Promise<JfEpisode[]> {
  const cfg = await loadCfg();
  if (!cfg) return [];
  try {
    const url = new URL(cfg.url.replace(/\/$/, '') + `/Shows/${encodeURIComponent(parentId)}/Episodes`);
    url.searchParams.set('Fields', 'Path,Overview');
    url.searchParams.set('SortBy', 'ParentIndexNumber,IndexNumber');
    const res = await fetch(url.toString(), { headers: authHeaders(cfg.apiKey) });
    if (!res.ok) return [];
    const data = (await res.json()) as { Items?: any[] };
    return (data.Items || []).map((ep: any) => ({
      Id: ep.Id,
      Name: ep.Name || ep.SeriesName || '—',
      Type: 'Episode',
      Path: ep.Path,
      IndexNumber: ep.IndexNumber,
      SeasonNumber: ep.ParentIndexNumber,
      Size: ep.Size
    }));
  } catch (e) {
    console.warn('[jellyfin] fetchEpisodes failed', (e as Error).message);
    return [];
  }
}

/** Delete an episode from Jellyfin */
export async function deleteEpisode(episodeId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadCfg();
  if (!cfg) return { ok: false, error: 'not configured' };
  try {
    const url = cfg.url.replace(/\/$/, '') + `/Items/${encodeURIComponent(episodeId)}`;
    const res = await fetch(url, { method: 'DELETE', headers: authHeaders(cfg.apiKey) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Get Jellyfin server status */
export async function getJellyfinStatus(): Promise<{
  connected: boolean;
  url?: string;
  movieCount?: number;
  seriesCount?: number;
  error?: string;
}> {
  const cfg = await loadCfg();
  if (!cfg) return { connected: false, error: 'not configured' };
  try {
    const url = cfg.url.replace(/\/$/, '') + '/System/Info';
    const res = await fetch(url, { headers: authHeaders(cfg.apiKey) });
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    const [movies, series] = await Promise.all([
      prisma.mediaServerItem.count({ where: { server: 'jellyfin', itemType: 'Movie' } }),
      prisma.mediaServerItem.count({ where: { server: 'jellyfin', itemType: 'Series' } })
    ]);
    return { connected: true, url: cfg.url, movieCount: movies, seriesCount: series };
  } catch (e) {
    return { connected: false, error: (e as Error).message };
  }
}
