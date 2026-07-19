// 1337x — public torrent index (HTML scraping, requires 2-step fetch).
// https://www.1337xx.to
import * as cheerio from 'cheerio';
import type { Indexer, SearchQuery, TorrentInfo, SearchContext } from './base';
import { parseSize } from '@/lib/utils';
import { fetchWithProxy } from '@/lib/proxy';

const BASE = 'https://www.1337xx.to';

export const leetx: Indexer = {
  domain: '1337xx.to',
  name: '1337x',
  url: BASE,
  async search(q: SearchQuery, ctx?: SearchContext) {
    const path = `/search/${encodeURIComponent(q.keyword)}/${q.page || 1}/`;
    const res = await fetchWithProxy('publicSites', BASE + path, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, ctx?.useProxy);
    if (!res.ok) throw new Error(`leetx list HTTP ${res.status}`);
    const html = await res.text();
    console.log('[leetx] html len', html.length, 'head', html.slice(0, 200));
    const $ = cheerio.load(html);
    const rows: Array<{ title: string; page: string; size: number; seeders: number; peers: number }> = [];
    $('table.table-list tbody tr').each((_, el) => {
      const $r = $(el);
      const nameCell = $r.find('td.name a').last();
      const title = nameCell.text().trim();
      const page = nameCell.attr('href') || '';
      const seeders = Number($r.find('td.seeds').text().trim()) || 0;
      const peers = Number($r.find('td.leeches').text().trim()) || 0;
      const sizeText = $r.find('td.size').clone().children().remove().end().text().trim();
      const size = parseSize(sizeText);
      if (title && page) rows.push({ title, page, size, seeders, peers });
    });

    // TEMP DEBUG: surface what the indexer actually received/parsed.
    if (rows.length === 0) {
      throw new Error(`leetx 0 rows (html=${html.length}B, hasTable=${$('table.table-list').length}, tbodyTr=${$('table.table-list tbody tr').length}, head=${html.slice(0, 120).replace(/\s+/g, ' ')})`);
    }

    // Fetch each detail page in parallel (bounded) to obtain magnet link
    const out: TorrentInfo[] = [];
    const chunks: Array<typeof rows> = [];
    for (let i = 0; i < rows.length; i += 5) chunks.push(rows.slice(i, i + 5));
    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (r) => {
          const detail = await fetchWithProxy('publicSites', BASE + r.page, {
            headers: { 'User-Agent': 'Mozilla/5.0 AIMediaCenter/0.1' }
          }, ctx?.useProxy);
          if (!detail.ok) throw new Error(`leetx detail HTTP ${detail.status} for ${r.page}`);
          const dh = await detail.text();
          const $d = cheerio.load(dh);
          const magnet = $d('a[href^="magnet:"]').first().attr('href') || '';
          if (!magnet) throw new Error(`leetx no magnet in detail (dh=${dh.length}B)`);
          return {
            key: `1337x:${r.page}`,
            site: '1337x',
            siteUrl: BASE,
            title: r.title,
            pageUrl: BASE + r.page,
            enclosure: magnet,
            size: r.size,
            seeders: r.seeders,
            peers: r.peers
          } as TorrentInfo;
        })
      );
      for (const rres of results) {
        if (rres.status === 'fulfilled' && rres.value) out.push(rres.value);
        else if (rres.status === 'rejected') console.warn('[leetx] detail failed:', rres.reason?.message || rres.reason);
      }
    }
    if (out.length === 0 && rows.length > 0) {
      throw new Error(`leetx 0 results from ${rows.length} rows (all detail fetches failed)`);
    }
    return out;
  }
};