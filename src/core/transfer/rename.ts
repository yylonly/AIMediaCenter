// Nunjucks-based rename engine — Jinja2-compatible templates.
import nunjucks from 'nunjucks';
import type { MetaInfo } from '../meta/types';
import type { TmdbBrief } from '../tmdb/client';
import { pad2 } from '@/lib/utils';
import type { MediaCategory } from './category';

const env = new nunjucks.Environment(null, { autoescape: false });
env.addFilter('pad2', (v: unknown) => pad2(v == null ? '' : (v as any)));
env.addFilter('lower', (v: unknown) => String(v ?? '').toLowerCase());
env.addFilter('upper', (v: unknown) => String(v ?? '').toUpperCase());

const ILLEGAL = /[\\/:*?"<>|]/g;
function safe(s: string): string {
  return s.replace(ILLEGAL, (c) => {
    const map: Record<string, string> = {
      '\\': '＼',
      '/': '／',
      ':': '：',
      '*': '＊',
      '?': '？',
      '"': '＂',
      '<': '＜',
      '>': '＞',
      '|': '｜'
    };
    return map[c] ?? c;
  });
}

export interface RenameCtx {
  title: string;
  originalTitle?: string;
  year?: string;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  part?: string;
  resourcePix?: string;
  resourceType?: string;
  videoEncode?: string;
  audioEncode?: string;
  releaseGroup?: string;
  fileExt: string;
  tmdbid?: number;
  imdbid?: string;
  /** Inferred media category slug (e.g. 'chinese-movie', 'jp-anime'). */
  mediaCategory?: MediaCategory;
}

export function buildRenameCtx(meta: MetaInfo, media?: TmdbBrief, fileExt = '', mediaCategory?: MediaCategory): RenameCtx {
  const title = media?.title || meta.title;
  return {
    title: safe(title),
    originalTitle: media?.originalTitle,
    year: media?.year || meta.year,
    season: meta.seasonBegin,
    episode: meta.episodeBegin,
    episodeEnd: meta.episodeEnd,
    part: meta.part,
    resourcePix: meta.resourcePix,
    resourceType: meta.resourceType,
    videoEncode: meta.videoEncode,
    audioEncode: meta.audioEncode,
    releaseGroup: meta.resourceTeam,
    fileExt: fileExt || meta.fileExt || '',
    tmdbid: media?.tmdbid,
    imdbid: media?.imdbid,
    mediaCategory
  };
}

/** Render a Nunjucks template with the given context. Path separators are preserved. */
export function renderPath(template: string, ctx: RenameCtx): string {
  const rendered = env.renderString(template, ctx as any);
  // Sanitize each path segment except the extension marker
  return rendered
    .split('/')
    .map((seg) => seg.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('/');
}
