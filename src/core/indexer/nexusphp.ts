// NexusPHP - generic private PT site indexer.
// NexusPHP is the most common framework for private BitTorrent trackers.
// Search URL: {site.url}/torrents.php?search={keyword}&search_mode=1
// Download URL: {site.url}/download.php?id={id}&passkey={passkey}
//
// Authentication: requires Cookie + (optionally) passkey per-site config from DB.
import * as cheerio from 'cheerio';
import type { Indexer, SearchQuery, TorrentInfo } from './base';
import { parseSize } from '@/lib/utils';
import { fetchWithProxy } from '@/lib/proxy';
import { prisma } from '@/lib/prisma';
import type { Site } from '@prisma/client';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function buildHeaders(site: Site): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': site.ua || DEFAULT_UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };
  if (site.cookie) headers['Cookie'] = site.cookie;
  return headers;
}

/** Resolve a possibly-relative NexusPHP URL against the site base. */
function resolveUrl(href: string, base: string): string {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return base.replace(/\/$/, '') + href;
  return base.replace(/\/$/, '') + '/' + href;
}

/** Extract torrent id from a details.php?id=X link. */
function extractTorrentId(href: string): number | null {
  const m = href.match(/[?&]id=(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Build the download.php URL for a NexusPHP torrent.
 * If passkey is configured, append it so the link works without a session.
 */
function buildDownloadUrl(base: string, id: number, passkey: string | null | undefined): string {
  const url = new URL(`${base.replace(/\/$/, '')}/download.php`);
  url.searchParams.set('id', String(id));
  if (passkey) url.searchParams.set('passkey', passkey);
  // https link hint, common NexusPHP parameter
  url.searchParams.set('https', '1');
  return url.toString();
}

/**
 * Detect free / promotional torrents from NexusPHP row markers.
 * Returns [downloadVolumeFactor, uploadVolumeFactor].
 * Defaults: [1, 1] (no discount). Free=2up -> [0, 2].
 */
function detectPromo($row: cheerio.Cheerio<any>): [number, number] {
  // NexusPHP commonly uses img class markers like pro_free, pro_2up, pro_50pctdown, etc.
  const cls = $row.find('img.h_r[H_H], img.pro_free, img.pro_2up, img.pro_50pctdown, img.pro_free2up, img.free').first();
  const marker = cls.attr('class') || cls.attr('alt') || '';
  let dl = 1;
  let ul = 1;
  if (/free/i.test(marker)) dl = 0;
  if (/2up|double/i.test(marker)) ul = 2;
  if (/50pct|half/i.test(marker)) dl = 0.5;
  return [dl, ul];
}

/**
 * Search a NexusPHP site using its DB config (cookie/ua/passkey).
 * Exported for direct use by registry/test route without going through the Indexer interface.
 */
export async function nexusphpSearch(site: Site, q: SearchQuery): Promise<TorrentInfo[]> {
  const base = site.url.replace(/\/$/, '');
  const headers = buildHeaders(site);

  // Build search URL - NexusPHP standard search params
  const url = new URL(`${base}/torrents.php`);
  url.searchParams.set('search', q.keyword);
  url.searchParams.set('search_mode', '1'); // 1=title, 0=everywhere
  // Some NexusPHP variants use 'search_area' instead
  if (q.mtype === 'movie') {
    url.searchParams.set('cat', '401'); // common Movie category - best effort
  } else if (q.mtype === 'tv') {
    url.searchParams.set('cat', '403'); // common TV category - best effort
  }
  if (q.page && q.page > 1) url.searchParams.set('page', String(q.page - 1));

  const res = await fetchWithProxy('ptSites', url.toString(), {
    headers,
    redirect: 'manual'
  });
  // Handle redirect to login page (typical when cookie expired)
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    if (/login|takelogin/i.test(loc)) {
      throw new Error(`Cookie expired or not logged in (redirected to ${loc})`);
    }
  }
  if (!res.ok && res.status !== 302) {
    throw new Error(`search HTTP ${res.status}`);
  }
  // Re-fetch without redirect:manual if we got a redirect to the actual results
  let html: string;
  if (res.status === 302) {
    const loc = res.headers.get('location') || '';
    if (/login|takelogin/i.test(loc)) {
      throw new Error('Cookie expired or not logged in');
    }
    const r2 = await fetchWithProxy('ptSites', resolveUrl(loc, base), { headers });
    html = await r2.text();
  } else {
    html = await res.text();
  }

  const $ = cheerio.load(html);
  const out: TorrentInfo[] = [];

  // NexusPHP torrent rows are direct <tr> children of table.torrents > tbody.
  // Use > to avoid matching nested table.torrentname rows (which repeat the title).
  const rowSelector = 'table.torrents > tbody > tr, table#torrents_table > tbody > tr, table.torrent_list > tbody > tr';
  $(rowSelector).each((_, el) => {
    const $r = $(el);

    // Title: first <a> linking to details.php?id=X
    const detailLink = $r.find('a[href*="details.php"]').first();
    if (!detailLink.length) return; // not a torrent row
    const detailHref = detailLink.attr('href') || '';
    const torrentId = extractTorrentId(detailHref);
    if (!torrentId) return;

    // Title: prefer title attr, then the <b> inside, then the link text
    const title =
      detailLink.attr('title') ||
      detailLink.find('b').first().text().trim() ||
      detailLink.text().trim();
    if (!title) return;

    // Deduplicate by torrentId (NexusPHP sometimes renders a collapsible desc row)
    if (out.some((t) => t.key === `${site.domain}:${torrentId}`)) return;

    // Find the download link directly if present (some themes expose download.php)
    let enclosure = '';
    const dlLink = $r.find('a[href*="download.php"]').first();
    if (dlLink.length) {
      enclosure = resolveUrl(dlLink.attr('href') || '', base);
    } else if (torrentId) {
      // Fallback: construct from id + passkey
      enclosure = buildDownloadUrl(base, torrentId, site.passkey);
    }

    // NexusPHP column layout (direct td.rowfollow children of the <tr>):
    //   [0] category icon  [1] title+desc  [2] ??  [3] time  [4] size
    //   [5] seeders (<b>)  [6] leechers    [7] completed  [8] uploader
    // We select direct children only to avoid matching nested table cells.
    const follows = $r.children('td.rowfollow');
    const followsText = follows.map((_, td) => $(td).text().trim()).get();

    // Size: find the cell matching a size pattern (e.g. "1.23 GB")
    let size = 0;
    for (const txt of followsText) {
      if (/^\d+(\.\d+)?\s*[KMGT]i?B$/i.test(txt)) {
        size = parseSize(txt);
        break;
      }
    }
    // Fallback: also scan all td descendants if direct children didn't match
    if (!size) {
      $r.find('td').each((_, td) => {
        if (size) return;
        const txt = $(td).text().trim();
        if (/^\d+(\.\d+)?\s*[KMGT]i?B$/i.test(txt)) size = parseSize(txt);
      });
    }

    // Seeders / leechers: find the cell with <b> (seeders) and the next cell (leechers).
    // In the standard layout, seeders is at index 5 (has <b>), leechers at index 6.
    let seeders = 0;
    let peers = 0;
    // Look for the td.rowfollow cell containing a direct <b> child that is numeric
    for (let i = 0; i < follows.length; i++) {
      const $td = follows.eq(i);
      const bText = $td.find('> b').first().text().trim().replace(/,/g, '');
      if (/^\d+$/.test(bText)) {
        seeders = Number(bText) || 0;
        // Leechers is the next td.rowfollow
        const nextTd = follows.eq(i + 1);
        const leechText = nextTd.text().trim().replace(/,/g, '');
        peers = /^\d+$/.test(leechText) ? Number(leechText) : 0;
        break;
      }
    }
    // Fallback: if no <b> pattern found, try last 3 numeric cells
    if (!seeders && follows.length >= 3) {
      const nums = followsText.filter((t) => /^\d+$/.test(t));
      if (nums.length >= 2) {
        seeders = Number(nums[nums.length - 2]) || 0;
        peers = Number(nums[nums.length - 1]) || 0;
      }
    }

    // Publish date: the td.rowfollow with nowrap class containing time text
    let publishDate: string | undefined;
    follows.each((_, td) => {
      if (publishDate) return;
      const $td = $(td);
      const t = $td.text().trim();
      // NexusPHP time formats: "19天7时", "1月7天", "3周5时", "2024-01-15 10:30:00"
      if (/^\d+[天月周]\d+[时天]?$/.test(t) || /\d{4}-\d{2}-\d{2}/.test(t)) {
        publishDate = t;
      }
    });

    // Promo detection
    const [dlFactor, ulFactor] = detectPromo($r);

    out.push({
      key: `${site.domain}:${torrentId}`,
      site: site.name,
      siteDomain: site.domain,
      siteUrl: base,
      title,
      pageUrl: resolveUrl(detailHref, base),
      enclosure,
      size,
      seeders,
      peers,
      downloadVolumeFactor: dlFactor,
      uploadVolumeFactor: ulFactor,
      publishDate
    });
  });

  return out;
}

/**
 * Build an Indexer instance bound to a specific Site config.
 * The indexer re-fetches the Site from DB on each search call so that
 * the latest cookie/passkey is always used (e.g. after a fresh login).
 */
export function createNexusphpIndexer(site: Site): Indexer {
  return {
    domain: site.domain,
    name: site.name,
    url: site.url,
    async search(q: SearchQuery) {
      // Re-fetch from DB to pick up the latest cookie/passkey
      const fresh = await prisma.site.findUnique({ where: { domain: site.domain } });
      return nexusphpSearch(fresh || site, q);
    }
  };
}
