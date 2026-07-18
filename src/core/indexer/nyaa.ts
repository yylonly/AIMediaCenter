// Nyaa — public anime torrent site. Use RSS-style query.
import * as cheerio from 'cheerio';
import type { Indexer, SearchQuery, TorrentInfo } from './base';
import { parseSize } from '@/lib/utils';
import { fetchWithProxy } from '@/lib/proxy';

export const nyaa: Indexer = {
  domain: 'nyaa.si',
  name: 'Nyaa',
  url: 'https://nyaa.si',
  async search(q: SearchQuery) {
    const url = new URL('https://nyaa.si/');
    url.searchParams.set('q', q.keyword);
    url.searchParams.set('f', '0');
    url.searchParams.set('c', '0_0');
    url.searchParams.set('s', 'seeders');
    url.searchParams.set('o', 'desc');
    if (q.page && q.page > 1) url.searchParams.set('p', String(q.page));
    const res = await fetchWithProxy('publicSites', url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 AIMediaCenter/0.1' }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const out: TorrentInfo[] = [];
    $('table.torrent-list tbody tr').each((_, el) => {
      const $row = $(el);
      const tds = $row.find('td');
      if (tds.length < 8) return;
      const titleEl = $(tds[1]).find('a').filter((_, a) => !$(a).hasClass('comments')).last();
      const title = titleEl.text().trim();
      const detailHref = titleEl.attr('href') || '';
      const links = $(tds[2]).find('a');
      let enclosure = '';
      links.each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href.startsWith('magnet:')) enclosure = href;
        else if (href.endsWith('.torrent') && !enclosure) enclosure = new URL(href, 'https://nyaa.si').toString();
      });
      const size = parseSize($(tds[3]).text().trim());
      const publishDate = $(tds[4]).text().trim();
      const seeders = Number($(tds[5]).text().trim()) || 0;
      const peers = Number($(tds[6]).text().trim()) || 0;
      if (!title || !enclosure) return;
      out.push({
        key: `nyaa:${detailHref}`,
        site: 'Nyaa',
        siteUrl: 'https://nyaa.si',
        title,
        pageUrl: detailHref ? new URL(detailHref, 'https://nyaa.si').toString() : undefined,
        enclosure,
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
