// Mikan (蜜柑计划) - anime RSS torrent site.
// https://mikanani.me
// Uses RSS XML feed for search results (no seeders/peers in RSS).
import * as cheerio from 'cheerio';
import type { Indexer, SearchQuery, TorrentInfo } from './base';
import { fetchWithProxy } from '@/lib/proxy';

const BASE = 'https://mikanani.me';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const mikan: Indexer = {
  domain: 'mikanani.me',
  name: 'Mikan',
  url: BASE,
  async search(q: SearchQuery) {
    const url = new URL(`${BASE}/RSS/Search`);
    url.searchParams.set('searchstr', q.keyword);

    const res = await fetchWithProxy('publicSites', url.toString(), { headers: { 'User-Agent': UA } });
    if (!res.ok) return [];
    const xml = await res.text();
    const $ = cheerio.load(xml, { xml: true });
    const out: TorrentInfo[] = [];

    $('item').each((_, el) => {
      const $item = $(el);
      const title = $item.find('title').first().text().trim();
      if (!title) return;

      const pageUrl = $item.find('link').first().text().trim() || undefined;

      // enclosure element carries the .torrent URL + size in bytes
      const enclosureEl = $item.find('enclosure');
      const enclosureUrl = enclosureEl.attr('url') || '';
      const contentLength = Number(enclosureEl.attr('length') || 0);

      // Fallback size from the <torrent><contentLength> element
      let size = contentLength;
      if (!size) {
        const cl = $item.find('contentLength').first().text().trim();
        size = Number(cl) || 0;
      }

      // Fallback size from description "[11.8GB]"
      if (!size) {
        const desc = $item.find('description').first().text();
        const m = desc.match(/\[([\d.]+)\s*([KMGT]i?B)\]/i);
        if (m) {
          const v = parseFloat(m[1]);
          const u = m[2].toUpperCase();
          const mult: Record<string, number> = {
            KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776,
            KIB: 1024, MIB: 1048576, GIB: 1073741824, TIB: 1099511627776
          };
          size = v * (mult[u] || 0);
        }
      }

      const pubDate = $item.find('pubDate').first().text().trim() || undefined;

      // Use the hash from enclosure URL as a unique key
      const hashMatch = enclosureUrl.match(/([0-9a-f]{32,40})\.torrent/i);
      const key = hashMatch ? hashMatch[1] : pageUrl || title;

      out.push({
        key: `mikan:${key}`,
        site: 'Mikan',
        siteDomain: 'mikanani.me',
        siteUrl: BASE,
        title,
        pageUrl,
        enclosure: enclosureUrl,
        size,
        seeders: 0, // RSS does not provide seeder/leecher counts
        peers: 0,
        category: 'tv',
        downloadVolumeFactor: 0,
        uploadVolumeFactor: 1,
        publishDate: pubDate
      });
    });

    return out;
  }
};
