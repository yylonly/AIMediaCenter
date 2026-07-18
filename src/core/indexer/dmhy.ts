// DMHY (动漫花园) — Chinese anime torrent site. HTML scraping.
// https://share.dmhy.org
import * as cheerio from 'cheerio';
import type { Indexer, SearchQuery, TorrentInfo, SearchContext } from './base';
import { parseSize } from '@/lib/utils';
import { fetchWithProxy } from '@/lib/proxy';

const BASE = 'https://share.dmhy.org';

export const dmhy: Indexer = {
  domain: 'share.dmhy.org',
  name: 'DMHY',
  url: BASE,
  async search(q: SearchQuery, ctx?: SearchContext) {
    const url = new URL(`${BASE}/topics/list`);
    url.searchParams.set('keyword', q.keyword);

    const res = await fetchWithProxy('publicSites', url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, ctx?.useProxy);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const out: TorrentInfo[] = [];

    $('table#topic_list tbody tr').each((_, el) => {
      const $r = $(el);
      const tds = $r.find('td');
      if (tds.length < 8) return;

      // Title: td.title first <a> (skip the team tag <a>)
      const titleEl = $(tds[2]).find('a').last();
      const title = titleEl.text().trim();
      const detailHref = titleEl.attr('href') || '';

      // Magnet: td with a.download-arrow.arrow-magnet
      const magnet = $(tds[3]).find('a.download-arrow').attr('href') || '';

      // Size: 5th td (index 4)
      const sizeText = $(tds[4]).text().trim();
      const size = parseSize(sizeText);

      // Seeders: 6th td (index 5)
      const seeders = Number($(tds[5]).text().trim()) || 0;

      // Peers: 7th td (index 6)
      const peers = Number($(tds[6]).text().trim()) || 0;

      // Publish date: 0th td
      const publishDate = $(tds[0]).text().trim().split('\n')[0].trim();

      if (!title || !magnet) return;
      out.push({
        key: `dmhy:${detailHref}`,
        site: 'DMHY',
        siteUrl: BASE,
        title,
        pageUrl: detailHref ? `${BASE}${detailHref}` : undefined,
        enclosure: magnet,
        size,
        seeders,
        peers,
        category: 'tv',
        publishDate
      });
    });
    return out;
  }
};