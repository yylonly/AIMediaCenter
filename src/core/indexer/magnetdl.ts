// MagnetDL — public torrent index with direct magnet links. HTML scraping.
// https://www.magnetdl.com
import * as cheerio from 'cheerio';
import type { Indexer, SearchQuery, TorrentInfo, SearchContext } from './base';
import { parseSize } from '@/lib/utils';
import { fetchWithProxy } from '@/lib/proxy';

const BASE = 'https://www.magnetdl.com';

export const magnetdl: Indexer = {
  domain: 'magnetdl.com',
  name: 'MagnetDL',
  url: BASE,
  async search(q: SearchQuery, ctx?: SearchContext) {
    // MagnetDL URL format: /{first-char}/{keyword}/
    const first = q.keyword.charAt(0).toLowerCase();
    const slug = q.keyword.replace(/\s+/g, '-').toLowerCase();
    const url = new URL(`${BASE}/${first}/${slug}/`);
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
    $('table.download tbody tr').each((_, el) => {
      const $r = $(el);
      const titleEl = $r.find('td.n a');
      const title = titleEl.attr('title') || titleEl.text().trim();
      const magnet = $r.find('td.m a').attr('href') || '';
      const sizeText = $r.find('td.s').text().trim();
      const size = parseSize(sizeText);
      const seeds = Number($r.find('td.v').text().trim().replace(/,/g, '')) || 0;
      const peers = Number($r.find('td.l').text().trim().replace(/,/g, '')) || 0;
      if (!title || !magnet) return;
      out.push({
        key: `magnetdl:${encodeURIComponent(title)}`,
        site: 'MagnetDL',
        siteUrl: BASE,
        title,
        pageUrl: titleEl.attr('href') ? `${BASE}${titleEl.attr('href')}` : undefined,
        enclosure: magnet,
        size,
        seeders: seeds,
        peers
      });
    });
    return out;
  }
};