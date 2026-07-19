// Transfer chain: given a completed download, organize files into the media library.
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { parseFilename } from '@/core/meta/metaVideo';
import { tmdbSearch, tmdbDetail, type TmdbBrief } from '@/core/tmdb/client';
import { walkVideos, findSubtitles, transferFile, type TransferMode } from '@/core/transfer/transferer';
import { buildRenameCtx, renderPath } from '@/core/transfer/rename';
import { scrapeMedia } from '@/core/tmdb/scraper';
import { ensureChineseSubtitle } from '@/core/subtitle/download';
import { refreshJellyfin } from '@/core/mediaserver/jellyfin';
import { inferMediaCategory, categoryType, type MediaCategory, type MediaType } from '@/core/transfer/category';

export interface PathRule {
  id: string;
  /** Display name, e.g. "华语电影". Auto-derived from category if blank. */
  name: string;
  /** Target media category for this rule. */
  category: MediaCategory;
  /** Transfer mode override for this rule. */
  transferType: TransferMode;
  /**
   * Media library subdir for this category. Relative paths are joined under
   * the media root; absolute paths are used as-is (escape hatch for rules
   * living outside the common roots, and for migrated legacy configs).
   */
  mediaSubdir: string;
  /** Download subdir for this category (same relative/absolute rule). */
  downloadSubdir: string;
  enabled: boolean;
}

export interface PathsConfig {
  /** 'container' = app runs in docker (needs in/out path mapping); 'standalone' = bare-metal/host. */
  deploymentMode: 'container' | 'standalone';
  /** Common media library root (container view). Changing it requires a container rebuild. */
  containerMediaRoot: string;
  /** Common media library root (host view; the only view in standalone mode). */
  hostMediaRoot: string;
  /** Common download root (container view). */
  containerDownloadRoot: string;
  /** Common download root (host view; what qBittorrent sees). */
  hostDownloadRoot: string;
  /** Category rules. Empty array => everything falls back to defaults. */
  rules: PathRule[];
  /** Fallback movie library subdir when no rule matches. */
  defaultMovieSubdir: string;
  /** Fallback tv library subdir when no rule matches. */
  defaultTvSubdir: string;
}

const DEFAULT_PATHS: PathsConfig = {
  deploymentMode: 'container',
  containerMediaRoot: process.env.CONTAINER_MEDIA_ROOT || '/media',
  hostMediaRoot: process.env.HOST_MEDIA_ROOT || process.env.CONTAINER_MEDIA_ROOT || '/media',
  containerDownloadRoot: process.env.CONTAINER_DOWNLOAD_ROOT || '/downloads',
  hostDownloadRoot: process.env.HOST_DOWNLOAD_ROOT || process.env.CONTAINER_DOWNLOAD_ROOT || '/downloads',
  rules: [],
  defaultMovieSubdir: 'movies',
  defaultTvSubdir: 'tv'
};

/** Join a (possibly absolute) subdir onto a root. */
function resolveUnder(root: string, sub: string): string {
  if (!sub) return root;
  return sub.startsWith('/') ? sub : path.posix.join(root, sub);
}

/** Strip a root prefix from a legacy full path ('/media/movies' -> 'movies'). */
function stripRoot(p: string, root: string): string {
  if (p === root) return '';
  if (p.startsWith(root + '/')) return p.slice(root.length + 1);
  return p;
}

/**
 * Coerce a partially-saved (or legacy 4-dir) rule into the subdir shape.
 * Legacy migration prefers stripping the host dir by the host root (the host
 * path carries the real directory names; container paths may be mount
 * aliases), falling back to the container dir.
 */
function normalizeRule(
  r: Partial<PathRule> & {
    id: string;
    containerMediaDir?: string;
    hostMediaDir?: string;
    containerDownloadDir?: string;
    hostDownloadDir?: string;
  },
  roots: { containerMediaRoot: string; hostMediaRoot: string; containerDownloadRoot: string; hostDownloadRoot: string }
): PathRule {
  const mediaSubdir =
    r.mediaSubdir ??
    (r.hostMediaDir
      ? stripRoot(r.hostMediaDir, roots.hostMediaRoot)
      : stripRoot(r.containerMediaDir || '/media/movies', roots.containerMediaRoot));
  const downloadSubdir =
    r.downloadSubdir ??
    (r.hostDownloadDir
      ? stripRoot(r.hostDownloadDir, roots.hostDownloadRoot)
      : stripRoot(r.containerDownloadDir || '/downloads', roots.containerDownloadRoot));
  return {
    id: r.id,
    name: r.name || '',
    category: r.category || 'foreign-movie',
    transferType: (r.transferType as TransferMode) || 'link',
    mediaSubdir,
    downloadSubdir,
    enabled: r.enabled !== false
  };
}

/**
 * Load the full paths config. Backwards-compatible: the previous 4-dir rule
 * shape ({ rules: [{ containerMediaDir, ... }] }), legacy single-object
 * configs ({ download, movie, tv, ... }) and the multi-profile shape
 * ({ activeId, profiles[] }) are auto-migrated to the root+subdir model so
 * nothing breaks on upgrade.
 */
export async function loadPaths(): Promise<PathsConfig> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'paths' } });
  if (!row) return { ...DEFAULT_PATHS };
  const roots = (v: Record<string, unknown>): Omit<PathsConfig, 'rules'> => ({
    deploymentMode: v.deploymentMode === 'standalone' ? 'standalone' : 'container',
    containerMediaRoot: (v.containerMediaRoot as string) || DEFAULT_PATHS.containerMediaRoot,
    hostMediaRoot: (v.hostMediaRoot as string) || DEFAULT_PATHS.hostMediaRoot,
    containerDownloadRoot: (v.containerDownloadRoot as string) || DEFAULT_PATHS.containerDownloadRoot,
    hostDownloadRoot: (v.hostDownloadRoot as string) || DEFAULT_PATHS.hostDownloadRoot,
    defaultMovieSubdir:
      (v.defaultMovieSubdir as string) ??
      stripRoot((v.defaultMovieDir as string) || '/media/movies', '/media'),
    defaultTvSubdir:
      (v.defaultTvSubdir as string) ?? stripRoot((v.defaultTvDir as string) || '/media/tv', '/media')
  });
  try {
    const v = JSON.parse(row.value) as Record<string, unknown>;
    // Current & previous shapes: { deploymentMode, rules[], ... }
    if (Array.isArray(v.rules)) {
      const r = roots(v);
      return { ...r, rules: (v.rules as PathRule[]).map((rule) => normalizeRule(rule, r)) };
    }
    // Legacy multi-profile shape: take the active profile's movie/tv as defaults.
    if (Array.isArray(v.profiles) && v.profiles.length > 0) {
      const profiles = v.profiles as Record<string, unknown>[];
      const activeId = (v.activeId as string) || (profiles[0].id as string);
      const p = profiles.find((x) => x.id === activeId) || profiles[0];
      return {
        ...roots({}),
        defaultMovieSubdir: stripRoot((p.movie as string) || '/media/movies', '/media'),
        defaultTvSubdir: stripRoot((p.tv as string) || '/media/tv', '/media'),
        rules: []
      };
    }
    // Legacy flat shape: { download, movie, tv, transferType, qbSavePath }
    if (typeof v.movie === 'string' || typeof v.tv === 'string') {
      return {
        ...roots({}),
        defaultMovieSubdir: stripRoot((v.movie as string) || '/media/movies', '/media'),
        defaultTvSubdir: stripRoot((v.tv as string) || '/media/tv', '/media'),
        rules: []
      };
    }
  } catch {
    /* fall through to default */
  }
  return { ...DEFAULT_PATHS };
}

/** Find the enabled rule matching a category (or null). */
export function matchRule(category: MediaCategory, cfg: PathsConfig): PathRule | null {
  return cfg.rules.find((r) => r.enabled && r.category === category) || null;
}

/**
 * Resolve the library dir + transfer mode for a category. Container mode
 * resolves under the in-container media root; standalone under the host
 * root. Falls back to the default movie/tv subdir when no rule matches.
 */
export function resolveLibraryDir(
  category: MediaCategory,
  cfg: PathsConfig
): { dir: string; mode: TransferMode } {
  const rule = matchRule(category, cfg);
  const root = cfg.deploymentMode === 'container' ? cfg.containerMediaRoot : cfg.hostMediaRoot;
  if (rule) return { dir: resolveUnder(root, rule.mediaSubdir), mode: rule.transferType };
  const sub = categoryType(category) === 'movie' ? cfg.defaultMovieSubdir : cfg.defaultTvSubdir;
  return { dir: resolveUnder(root, sub), mode: 'link' };
}

/**
 * Resolve both views of a rule's download dir: the qb (host) view and the
 * app view (container root in container mode, host root in standalone).
 */
export function resolveDownloadDirs(
  rule: PathRule | null,
  cfg: PathsConfig
): { qbDir: string; appDir: string } {
  const sub = rule?.downloadSubdir || '';
  const appRoot = cfg.deploymentMode === 'container' ? cfg.containerDownloadRoot : cfg.hostDownloadRoot;
  return {
    qbDir: resolveUnder(cfg.hostDownloadRoot, sub),
    appDir: resolveUnder(appRoot, sub)
  };
}

/**
 * Resolve the download dir that qBittorrent should save into, for a category.
 * qb always operates on its own (host) view.
 */
export function resolveDownloadDir(category: MediaCategory, cfg: PathsConfig): string {
  return resolveDownloadDirs(matchRule(category, cfg), cfg).qbDir;
}

/** Look up a rule by id (for transferPoll to reuse the historical rule). */
export async function loadRuleById(id?: string | null): Promise<PathRule | null> {
  if (!id) return null;
  const cfg = await loadPaths();
  return cfg.rules.find((r) => r.id === id) || null;
}

export interface QbPathHint {
  contentPath?: string;
  savePath: string;
  name: string;
}

/**
 * Translate a qb-reported content path (qb's host view) into the app-view
 * path using the rule's download dirs. Shared by transferPoll and the
 * manual-organize endpoint.
 */
export function resolveAppViewPath(t: QbPathHint, rule: PathRule | null, cfg: PathsConfig): string {
  const { qbDir, appDir } = resolveDownloadDirs(rule, cfg);
  const qbPath = qbDir.replace(/\/$/, '');
  const appPath = appDir.replace(/\/$/, '');
  const containerPath = t.contentPath || `${t.savePath.replace(/\/$/, '')}/${t.name}`;
  return qbPath && qbPath !== appPath ? containerPath.replace(qbPath, appPath) : containerPath;
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
      const resolvedType: MediaType = (opts.mtype || media?.type || meta.type) as MediaType;
      const isTv = resolvedType === 'tv';
      // Infer media category from TMDB metadata, then resolve the library
      // dir + transfer mode from the matching PathRule (or defaults).
      const category = inferMediaCategory(
        resolvedType,
        media?.genreIds || media?.genres?.map((g) => g.id) || [],
        media?.originCountry || [],
        media?.originalLanguage
      );
      const { dir: libRoot, mode: ruleMode } = resolveLibraryDir(category, paths);
      const mode = opts.mode || ruleMode;
      const template = isTv ? naming.tv : naming.movie;
      const ctx = buildRenameCtx(meta, media, path.extname(src), category);
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
      // No subtitle came along with the source: try downloading a Chinese
      // one (best-effort, never breaks the organize flow).
      if (subs.length === 0 && media) {
        await ensureChineseSubtitle(dest, media, meta).catch((e) =>
          console.warn('[transfer] subtitle download failed', (e as Error).message)
        );
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
          dest: '',
          mode: opts.mode || 'link',
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
