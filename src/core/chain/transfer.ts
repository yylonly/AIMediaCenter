// Transfer chain: given a completed download, organize files into the media library.
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { parseFilename } from '@/core/meta/metaVideo';
import { tmdbSearch, tmdbDetail, type TmdbBrief } from '@/core/tmdb/client';
import { walkVideos, findSubtitles, transferFile, type TransferMode } from '@/core/transfer/transferer';
import { buildRenameCtx, renderPath } from '@/core/transfer/rename';
import { scrapeMedia } from '@/core/tmdb/scraper';
import { refreshJellyfin } from '@/core/mediaserver/jellyfin';

export interface PathProfile {
  /** Unique id (uuid-ish or slug). */
  id: string;
  /** Display name, e.g. "NAS 套件" or "Docker 栈". */
  name: string;
  /** App-side view of the download dir (what organize() sees in-container). */
  download: string;
  /**
   * Path as qBittorrent sees its save location. On a docker-compose stack
   * where qb shares a volume with the app this equals `download` (e.g.
   * `/downloads`); on NAS deployments where qb is a host suite it's the
   * host path (e.g. `/volume1/qBittorent`). Empty falls back to `download`.
   */
  qbSavePath: string;
  /** Movie library root (organize destination for movies). */
  movie: string;
  /** TV library root (organize destination for tv). */
  tv: string;
  /** Transfer mode: link/softlink/copy/move. */
  transferType: TransferMode;
}

export interface PathsConfig {
  /** Id of the currently active profile (must exist in `profiles`). */
  activeId: string;
  /** All saved profiles. At least one must always exist. */
  profiles: PathProfile[];
}

const DEFAULT_PROFILE: PathProfile = {
  id: 'default',
  name: '默认',
  download: '/downloads',
  qbSavePath: '',
  movie: '/media/movies',
  tv: '/media/tv',
  transferType: 'link'
};

/** Fill missing fields / apply fallbacks (qbSavePath -> download). */
function normalizeProfile(p: Partial<PathProfile> & { id: string }): PathProfile {
  const download = p.download || '/downloads';
  return {
    id: p.id,
    name: p.name || '未命名',
    download,
    qbSavePath: p.qbSavePath || download,
    movie: p.movie || '/media/movies',
    tv: p.tv || '/media/tv',
    transferType: (p.transferType as TransferMode) || 'link'
  };
}

/**
 * Load the currently active path profile. Backwards-compatible: old single-
 * object configs ({ download, movie, tv, ... } without `profiles`) are
 * auto-wrapped into a single 'default' profile so no DB migration is needed.
 */
export async function loadPaths(): Promise<PathProfile> {
  const cfg = await loadPathsConfig();
  const active = cfg.profiles.find((p) => p.id === cfg.activeId) || cfg.profiles[0];
  return normalizeProfile(active);
}

/** Load the full paths config (all profiles + activeId) for UI editing. */
export async function loadPathsConfig(): Promise<PathsConfig> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'paths' } });
  if (!row) return { activeId: DEFAULT_PROFILE.id, profiles: [DEFAULT_PROFILE] };
  try {
    const v = JSON.parse(row.value) as Partial<PathsConfig> & Record<string, unknown>;
    // New format: { activeId, profiles[] }
    if (Array.isArray(v.profiles) && v.profiles.length > 0) {
      const profiles = v.profiles.map((p) => normalizeProfile(p as PathProfile));
      const activeId = (v.activeId as string) || profiles[0].id;
      return { activeId, profiles };
    }
    // Old format: single flat object { download, movie, tv, transferType, qbSavePath }
    if (typeof v.download === 'string' || typeof v.movie === 'string') {
      const migrated: PathProfile = normalizeProfile({
        id: 'default',
        name: '默认',
        download: v.download as string,
        qbSavePath: v.qbSavePath as string,
        movie: v.movie as string,
        tv: v.tv as string,
        transferType: v.transferType as TransferMode
      });
      return { activeId: 'default', profiles: [migrated] };
    }
  } catch {
    /* fall through to default */
  }
  return { activeId: DEFAULT_PROFILE.id, profiles: [DEFAULT_PROFILE] };
}

/** Look up a specific profile by id (returns normalized or default). */
export async function loadProfileById(id?: string | null): Promise<PathProfile> {
  if (!id) return loadPaths();
  const cfg = await loadPathsConfig();
  const p = cfg.profiles.find((x) => x.id === id);
  return p ? normalizeProfile(p) : loadPaths();
}
interface Naming {
  movie: string;
  tv: string;
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
