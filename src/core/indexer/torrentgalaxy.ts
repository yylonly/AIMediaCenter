// TorrentGalaxy — public torrent site. HTML scraping.
// https://torrentgalaxy.one — list page → detail page → magnet
import * as cheerio from 'cheerio';
import type { Indexer, SearchQuery, TorrentInfo } from './base';
import { parseSize } from '@/lib/utils';

const BASE = 'https://torrentgalaxy.one';

export const torrentgalaxy: Indexer = {
  domain: 'torrentgalaxy.one',
  name: 'TorrentGalaxy',
  url: BASE,
  async search(q: SearchQuery) {
    const url = new URL(`${BASE}/get-posts/keywords:${encodeURIComponent(q.keyword)}`);
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    // Collect rows from listing page
    const rows: Array<{
      title: string;
      detail: string;
      size: number;
      seeders: number;
      peers: number;
    }> = [];

    $('div.tgxtablerow').each((_, el) => {
      const $r = $(el);
      const titleEl = $r.find('a[title]').first();
      const title = titleEl.attr('title') || titleEl.text().trim();
      const detailHref = $r.find('div.clickable-row').attr('data-href') || '';
      // Size lives in span.badge-secondary, but the row has two of them
      // (main + responsive), so .text() concatenates "721.3 MB721.3 MB" which
      // parseSize rejects. Take only the first one.
      const sizeText = $r.find('span.badge-secondary').first().text().trim();
      const size = parseSize(sizeText);
      // seeders: green font, peers: red font
      const greenB = $r.find('font[color="green"] b, font b[style*="green"]').text().trim();
      const redB = $r.find('font[color="#ff0000"] b, font[color="red"] b').text().trim();
      const seeders = Number(greenB.replace(/,/g, '')) || 0;
      const peers = Number(redB.replace(/,/g, '')) || 0;
      if (!title || !detailHref) return;
      rows.push({ title, detail: detailHref, size, seeders, peers });
    });

    // Fetch detail pages in batches to get magnet links
    const out: TorrentInfo[] = [];
    const chunks: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += 5) chunks.push(rows.slice(i, i + 5));

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (r) => {
          const detailUrl = r.detail.startsWith('http') ? r.detail : `${BASE}${r.detail}`;
          const dres = await fetch(detailUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          if (!dres.ok) return null;
          const dh = await dres.text();
          const $d = cheerio.load(dh);
          const magnet = $d('a[href^="magnet:"]').first().attr('href') || '';
          if (!magnet) return null;
          return {
            key: `tgx:${r.detail}`,
            site: 'TorrentGalaxy',
            siteUrl: BASE,
            title: r.title,
            pageUrl: detailUrl,
            enclosure: magnet,
            size: r.size,
            seeders: r.seeders,
            peers: r.peers
          } as TorrentInfo;
        })
      );
      for (const rres of results) {
        if (rres.status === 'fulfilled' && rres.value) out.push(rres.value);
      }
    }
    return out;
  }
};