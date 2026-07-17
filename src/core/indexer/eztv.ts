// EZTV — public TV torrent site with JSON API.
// https://eztvx.to/api/get-torrents
import type { Indexer, SearchQuery, TorrentInfo } from './base';

const BASE = 'https://eztvx.to';

export const eztv: Indexer = {
  domain: 'eztvx.to',
  name: 'EZTV',
  url: BASE,
  async search(q: SearchQuery) {
    if (q.mtype === 'movie') return [];
    const url = new URL(`${BASE}/api/get-torrents`);
    url.searchParams.set('q', q.keyword);
    url.searchParams.set('limit', '50');
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 AIMediaCenter/0.1' }
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      torrents?: Array<{
        id: string;
        title: string;
        magnet_url: string;
        size_bytes: string;
        seeds: string;
        peers: string;
        date_released_unix: string;
        episode_url?: string;
      }>;
    };
    const out: TorrentInfo[] = [];
    for (const t of data.torrents || []) {
      out.push({
        key: `eztv:${t.id}`,
        site: 'EZTV',
        siteUrl: BASE,
        title: t.title,
        pageUrl: t.episode_url || undefined,
        enclosure: t.magnet_url,
        size: Number(t.size_bytes) || 0,
        seeders: Number(t.seeds) || 0,
        peers: Number(t.peers) || 0,
        category: 'tv',
        publishDate: t.date_released_unix
          ? new Date(Number(t.date_released_unix) * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : undefined
      });
    }
    return out;
  }
};