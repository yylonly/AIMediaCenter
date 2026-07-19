// Transfer chain: given a completed download, organize files into the media library.
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { parseFilename } from '@/core/meta/metaVideo';
import { tmdbSearch, tmdbDetail, type TmdbBrief } from '@/core/tmdb/client';
import { walkVideos, findSubtitles, transferFile, type TransferMode } from '@/core/transfer/transferer';
import { buildRenameCtx, renderPath } from '@/core/transfer/rename';
import { scrapeMedia } from '@/core/tmdb/scraper';
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
  /** Container-side media library dir (container deployment). */
  containerMediaDir: string;
  /** Host-side media library dir (standalone, or host view for container). */
  hostMediaDir: string;
  /** Container-side download dir (container deployment). */
  containerDownloadDir: string;
  /** Host-side download dir (standalone, or host view for container). */
  hostDownloadDir: string;
  enabled: boolean;
}

export interface PathsConfig {
  /** 'container' = app runs in docker (needs in/out path mapping); 'standalone' = bare-metal/host. */
  deploymentMode: 'container' | 'standalone';
  /** Category rules. Empty array => everything falls back to defaults. */
  rules: PathRule[];
  /** Fallback movie library dir when no rule matches (host view for standalone). */
  defaultMovieDir: string;
  /** Fallback tv library dir when no rule matches (host view for standalone). */
  defaultTvDir: string;
}

const DEFAULT_PATHS: PathsConfig = {
  deploymentMode: 'container',
  rules: [],
  defaultMovieDir: '/media/movies',
  defaultTvDir: '/media/tv'
};

/** Coerce a partially-saved rule into a complete one with defaults. */
function normalizeRule(r: Partial<PathRule> & { id: string }): PathRule {
  return {
    id: r.id,
    name: r.name || '',
    category: r.category || 'foreign-movie',
    transferType: (r.transferType as TransferMode) || 'link',
    containerMediaDir: r.containerMediaDir || '/media/movies',
    hostMediaDir: r.hostMediaDir || '/media/movies',
    containerDownloadDir: r.containerDownloadDir || '/downloads',
    hostDownloadDir: r.hostDownloadDir || '/downloads',
    enabled: r.enabled !== false
  };
}

/**
 * Load the full paths config. Backwards-compatible: legacy single-object
 * configs ({ download, movie, tv, ... }) and the multi-profile shape
 * ({ activeId, profiles[] }) are auto-migrated to { rules: [], defaultMovieDir,
 * defaultTvDir } so nothing breaks on upgrade.
 */
export async function loadPaths(): Promise<PathsConfig> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'paths' } });
  if (!row) return { ...DEFAULT_PATHS };
  try {
    const v = JSON.parse(row.value) as Record<string, unknown>;
    // New shape: { deploymentMode, rules[], defaultMovieDir, defaultTvDir }
    if (Array.isArray(v.rules)) {
      return {
        deploymentMode: v.deploymentMode === 'standalone' ? 'standalone' : 'container',
        rules: (v.rules as PathRule[]).map(normalizeRule),
        defaultMovieDir: (v.defaultMovieDir as string) || '/media/movies',
        defaultTvDir: (v.defaultTvDir as string) || '/media/tv'
      };
    }
    // Legacy multi-profile shape: take the active profile's movie/tv as defaults.
    if (Array.isArray(v.profiles) && v.profiles.length > 0) {
      const profiles = v.profiles as Record<string, unknown>[];
      const activeId = (v.activeId as string) || (profiles[0].id as string);
      const p = profiles.find((x) => x.id === activeId) || profiles[0];
      return {
        deploymentMode: 'container',
        rules: [],
        defaultMovieDir: (p.movie as string) || '/media/movies',
        defaultTvDir: (p.tv as string) || '/media/tv'
      };
    }
    // Legacy flat shape: { download, movie, tv, transferType, qbSavePath }
    if (typeof v.movie === 'string' || typeof v.tv === 'string') {
      return {
        deploymentMode: 'container',
        rules: [],
        defaultMovieDir: (v.movie as string) || '/media/movies',
        defaultTvDir: (v.tv as string) || '/media/tv'
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
 * reads the rule's in-container media dir; standalone reads the host media
 * dir. Falls back to defaultMovieDir/defaultTvDir when no rule matches.
 */
export function resolveLibraryDir(
  category: MediaCategory,
  cfg: PathsConfig
): { dir: string; mode: TransferMode } {
  const rule = matchRule(category, cfg);
  const type = categoryType(category);
  const defaultDir = type === 'movie' ? cfg.defaultMovieDir : cfg.defaultTvDir;
  if (!rule) return { dir: defaultDir, mode: 'link' };
  const dir = cfg.deploymentMode === 'container' ? rule.containerMediaDir : rule.hostMediaDir;
  return { dir, mode: rule.transferType };
}

/**
 * Resolve the download dir that qBittorrent should save into, for a category.
 * qb always operates on its own (host) view; falls back to container dir.
 */
export function resolveDownloadDir(category: MediaCategory, cfg: PathsConfig): string {
  const rule = matchRule(category, cfg);
  if (!rule) return '/downloads';
  return rule.hostDownloadDir || rule.containerDownloadDir || '/downloads';
}

/** Look up a rule by id (for transferPoll to reuse the historical rule). */
export async function loadRuleById(id?: string | null): Promise<PathRule | null> {
  if (!id) return null;
  const cfg = await loadPaths();
  return cfg.rules.find((r) => r.id === id) || null;
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
