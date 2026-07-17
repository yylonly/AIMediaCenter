// YTS — official JSON API for movies (public, no auth).
// https://yts.gg/api/v2/list_movies.json?query_term=...
import type { Indexer, TorrentInfo, SearchQuery } from './base';

const BASE = 'https://yts.gg';

export const yts: Indexer = {
  domain: 'yts.gg',
  name: 'YTS',
  url: BASE,
  async search(q: SearchQuery) {
    if (q.mtype === 'tv') return [];
    const url = new URL('https://yts.gg/api/v2/list_movies.json');
    url.searchParams.set('query_term', q.keyword);
    url.searchParams.set('page', String(q.page || 1));
    url.searchParams.set('limit', '30');
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 AIMediaCenter/0.1' }
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { movies?: Array<{
        id: number;
        title_long: string;
        year: number;
        imdb_code?: string;
        url?: string;
        torrents?: Array<{
          url: string;
          hash: string;
          quality: string;
          type: string;
          size_bytes: number;
          seeds: number;
          peers: number;
          date_uploaded: string;
        }>;
      }> };
    };
    const out: TorrentInfo[] = [];
    for (const m of data.data?.movies || []) {
      for (const t of m.torrents || []) {
        out.push({
          key: `yts:${t.hash}`,
          site: 'YTS',
          siteUrl: BASE,
          title: `${m.title_long} [${t.quality} ${t.type}] YTS`,
          description: t.quality,
          pageUrl: m.url,
          enclosure: t.url,
          size: t.size_bytes,
          seeders: t.seeds,
          peers: t.peers,
          category: 'movie',
          downloadVolumeFactor: 0,
          uploadVolumeFactor: 1,
          publishDate: t.date_uploaded,
          imdbid: m.imdb_code
        });
      }
    }
    return out;
  }
};
