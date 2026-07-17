// Download orchestration: enclosure → qB → DownloadHistory row.
import { prisma } from '@/lib/prisma';
import { addTorrent, getQbConfig } from '@/core/downloader/qbittorrent';
import { parseFilename } from '@/core/meta/metaVideo';
import { tmdbSearch } from '@/core/tmdb/client';
import type { TorrentInfo } from '@/core/indexer/base';
import type { TmdbBrief } from '@/core/tmdb/client';

export interface DownloadOptions {
  torrent: TorrentInfo;
  media?: TmdbBrief;
  username?: string;
}

/** Enqueue a torrent to qBittorrent and record history. */
export async function submitDownload(opts: DownloadOptions): Promise<{
  ok: boolean;
  hash?: string;
  historyId?: number;
  error?: string;
}> {
  const { torrent, media: providedMedia, username } = opts;
  const cfg = await getQbConfig();
  if (!cfg) return { ok: false, error: 'qBittorrent not configured' };

  const meta = parseFilename(torrent.title);

  // Auto-match TMDB if user didn't manually select a media item.
  // This ensures correct type classification (movie vs tv) even for
  // titles that the filename parser can't classify.
  let media = providedMedia ?? null;
  if (!media) {
    const query = meta.cnName || meta.enName;
    if (query) {
      const results = await tmdbSearch(query, 3);
      // Prefer exact type match; prefer year match
      const preferType = meta.type === 'unknown' ? undefined : meta.type;
      const picked = results.find(
        (r) => (preferType ? r.type === preferType : true) && (!meta.year || r.year === meta.year)
      ) || results[0];
      if (picked) media = picked;
    }
  }

  // Type detection: TMDB match > filename parser > torrent category > default movie
  const isTv =
    media?.type === 'tv' ||
    (!media?.type && meta.type === 'tv') ||
    (!media?.type && meta.type === 'unknown' && torrent.category === 'tv');
  const category = isTv ? cfg.categoryTv : cfg.categoryMovie;

  // qBittorrent runs in Docker — always use the container-side path.
  // The host path (config 'paths.download') is only used for post-download
  // operations like transferPoll, not for telling qB where to save.
  const savepath = `/downloads/${isTv ? 'tv' : 'movies'}`;

  // For private PT sites, attach Cookie/UA/Referer to the .torrent download.
  // The enclosure URL may already carry &passkey= (set by NexusPHP indexer).
  let headers: Record<string, string> | undefined;
  let enclosure = torrent.enclosure;
  const domain = torrent.siteDomain;
  if (domain && !enclosure.startsWith('magnet:')) {
    const site = await prisma.site.findUnique({ where: { domain } });
    if (site) {
      const h: Record<string, string> = {
        'User-Agent': site.ua || 'Mozilla/5.0 AIMediaCenter/0.1'
      };
      if (site.cookie) h['Cookie'] = site.cookie;
      // NexusPHP download.php often requires a Referer to avoid hotlink blocks
      if (/download\.php/.test(enclosure)) {
        h['Referer'] = site.url.replace(/\/$/, '') + '/';
        // Ensure passkey is on the URL if not already present
        if (site.passkey && !/[?&]passkey=/.test(enclosure)) {
          enclosure = enclosure + (enclosure.includes('?') ? '&' : '?') + 'passkey=' + site.passkey;
        }
      }
      headers = h;
    }
  }

  const add = await addTorrent(enclosure, {
    savepath,
    category,
    tags: ['aimediacenter'],
    paused: false,
    headers
  });
  if (!add.ok) return { ok: false, error: add.error };

  // Skip if this download hash already exists in history
  if (add.hash) {
    const existing = await prisma.downloadHistory.findUnique({ where: { downloadHash: add.hash } });
    if (existing) return { ok: true, hash: add.hash, historyId: existing.id };
  }

  const history = await prisma.downloadHistory.create({
    data: {
      path: savepath,
      type: isTv ? 'tv' : 'movie',
      title: media?.title || meta.title,
      year: media?.year || meta.year,
      tmdbid: media?.tmdbid,
      imdbid: media?.imdbid || torrent.imdbid,
      seasons: meta.seasonBegin != null ? `S${String(meta.seasonBegin).padStart(2, '0')}` : null,
      episodes:
        meta.episodeBegin != null
          ? `E${String(meta.episodeBegin).padStart(2, '0')}${
              meta.episodeEnd ? '-E' + String(meta.episodeEnd).padStart(2, '0') : ''
            }`
          : null,
      image: media?.poster,
      downloadHash: add.hash,
      torrentName: torrent.title,
      torrentDescription: torrent.description,
      torrentSite: torrent.site,
      username
    }
  });
  return { ok: true, hash: add.hash, historyId: history.id };
}
