// Transfer chain: given a completed download, organize files into the media library.
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { parseFilename } from '@/core/meta/metaVideo';
import { tmdbSearch, tmdbDetail, type TmdbBrief } from '@/core/tmdb/client';
import { walkVideos, findSubtitles, transferFile, type TransferMode } from '@/core/transfer/transferer';
import { buildRenameCtx, renderPath } from '@/core/transfer/rename';
import { scrapeMedia } from '@/core/tmdb/scraper';
import { refreshJellyfin } from '@/core/mediaserver/jellyfin';

interface Paths {
  download: string;
  movie: string;
  tv: string;
  transferType: TransferMode;
}
interface Naming {
  movie: string;
  tv: string;
}

async function loadPaths(): Promise<Paths> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'paths' } });
  const p = row ? (JSON.parse(row.value) as Paths) : ({} as Paths);
  return {
    download: p.download || '/downloads',
    movie: p.movie || '/media/movies',
    tv: p.tv || '/media/tv',
    transferType: (p.transferType as TransferMode) || 'link'
  };
}

async function loadNaming(): Promise<Naming> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'naming' } });
  const n = row ? (JSON.parse(row.value) as Naming) : ({} as Naming);
  return {
    movie:
      n.movie ||
      "{{title}} ({{year}})/{{title}} ({{year}}){{ ' - ' + resourcePix if resourcePix }}{{fileExt}}",
    tv:
      n.tv ||
      '{{title}} ({{year}})/Season {{season}}/{{title}} - S{{season | pad2}}E{{episode | pad2}}{{fileExt}}'
  };
}

async function recognizeMedia(filename: string): Promise<{ meta: ReturnType<typeof parseFilename>; media?: TmdbBrief }> {
  const meta = parseFilename(filename);
  const query = meta.cnName || meta.enName;
  if (!query) return { meta };
  try {
    const results = await tmdbSearch(query, 5);
    const preferType = meta.type === 'unknown' ? undefined : meta.type;
    const picked = results.find((r) => (preferType ? r.type === preferType : true) && (!meta.year || r.year === meta.year)) || results[0];
    if (!picked) return { meta };
    const detail = await tmdbDetail(picked.tmdbid, picked.type);
    return { meta, media: detail || picked };
  } catch (e) {
    console.warn('[transfer] TMDB recognize failed', (e as Error).message);
    return { meta };
  }
}

export interface TransferOptions {
  /** Absolute directory (or single file) to transfer. */
  source: string;
  /** Optional download hash to link to DownloadHistory */
  downloadHash?: string;
  /** Force TMDB id (when the user manually pinned). */
  tmdbid?: number;
  mtype?: 'movie' | 'tv';
  /** Override mode from config. */
  mode?: TransferMode;
  scrape?: boolean;
}

export async function organize(opts: TransferOptions): Promise<{
  ok: boolean;
  transferred: number;
  errors: string[];
}> {
  const paths = await loadPaths();
  const naming = await loadNaming();
  const mode = opts.mode || paths.transferType;
  const errors: string[] = [];
  let transferred = 0;

  const stat = await import('node:fs/promises').then((m) => m.stat(opts.source).catch(() => null));
  if (!stat) return { ok: false, transferred: 0, errors: ['source not found: ' + opts.source] };
  const files: string[] = [];
  if (stat.isDirectory()) {
    for await (const f of walkVideos(opts.source)) files.push(f);
  } else {
    files.push(opts.source);
  }

  for (const src of files) {
    try {
      const filename = path.basename(src);
      const { meta, media } = await recognizeMedia(filename);
      // Type priority: caller-supplied mtype > TMDB match > filename parser > default movie
      const resolvedType = opts.mtype || media?.type || meta.type;
      const isTv = resolvedType === 'tv';
      const libRoot = isTv ? paths.tv : paths.movie;
      const template = isTv ? naming.tv : naming.movie;
      const ctx = buildRenameCtx(meta, media, path.extname(src));
      const rel = renderPath(template, ctx);
      const dest = path.join(libRoot, rel);
      await transferFile(src, dest, mode);

      // Subtitles
      const subs = await findSubtitles(src);
      for (const sub of subs) {
        const subExt = path.extname(sub);
        const subDest = dest.replace(/\.[^.]+$/, subExt);
        await transferFile(sub, subDest, mode);
      }

      // Scrape (nfo + poster)
      if (opts.scrape !== false && media) {
        await scrapeMedia(dest, media);
      }

      await prisma.transferHistory.create({
        data: {
          src,
          dest,
          mode,
          type: isTv ? 'tv' : 'movie',
          title: media?.title || meta.title,
          year: media?.year || meta.year,
          tmdbid: media?.tmdbid,
          imdbid: media?.imdbid,
          seasons: meta.seasonBegin != null ? `S${String(meta.seasonBegin).padStart(2, '0')}` : null,
          episodes: meta.episodeBegin != null ? `E${String(meta.episodeBegin).padStart(2, '0')}` : null,
          image: media?.poster,
          downloadHash: opts.downloadHash,
          status: true,
          files: JSON.stringify([src])
        }
      });
      transferred++;
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`${src}: ${msg}`);
      await prisma.transferHistory.create({
        data: {
          src,
          mode,
          type: opts.mtype || 'movie',
          title: path.basename(src),
          status: false,
          errmsg: msg,
          downloadHash: opts.downloadHash
        }
      });
    }
  }

  // Trigger Jellyfin refresh (best-effort)
  if (transferred > 0) {
    refreshJellyfin().catch((e) => console.warn('[transfer] jellyfin refresh failed', (e as Error).message));
  }

  return { ok: errors.length === 0, transferred, errors };
}
