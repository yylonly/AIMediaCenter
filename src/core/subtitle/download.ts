// Orchestrates Chinese-subtitle download for an organized media file.
// Called from the transfer chain after scraping; failures never break the
// organize flow (logged and skipped).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TmdbBrief } from '@/core/tmdb/client';
import {
  loadSubtitleConfig,
  searchSubtitles,
  downloadSubtitle,
  QuotaExceededError,
  type OsSubtitleHit
} from './opensubtitles';

interface MetaHint {
  title?: string;
  enName?: string;
  cnName?: string;
  seasonBegin?: number | null;
  episodeBegin?: number | null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function languagesParam(language: string): string {
  if (language === 'zh-TW') return 'zh-TW';
  if (language === 'both') return 'zh-CN,zh-TW';
  return 'zh-CN';
}

function pickBest(hits: OsSubtitleHit[], language: string): OsSubtitleHit | null {
  if (hits.length === 0) return null;
  const sorted = [...hits].sort((a, b) => {
    if (language === 'both') {
      // Simplified first on ties, then download count.
      const az = a.language === 'zh-CN' ? 0 : 1;
      const bz = b.language === 'zh-CN' ? 0 : 1;
      if (az !== bz) return az - bz;
    }
    return b.downloadCount - a.downloadCount;
  });
  return sorted[0];
}

/**
 * Ensure a Chinese subtitle sits next to the organized video file
 * (<videoBase>.zh.srt). Returns true when the file is present afterwards
 * (already existed or freshly downloaded).
 */
export async function ensureChineseSubtitle(
  videoPath: string,
  media: TmdbBrief | undefined,
  meta: MetaHint
): Promise<boolean> {
  const cfg = await loadSubtitleConfig();
  if (!cfg.enabled || !cfg.downloadOnOrganize || !cfg.apiKey) return false;

  const dest = videoPath.replace(/\.[^.]+$/, '.zh.srt');
  if (await fileExists(dest)) return true;

  const query = media?.originalTitle || media?.title || meta.enName || meta.cnName || meta.title;
  try {
    const hits = await searchSubtitles(cfg, {
      filePath: videoPath,
      query,
      season: meta.seasonBegin ?? undefined,
      episode: meta.episodeBegin ?? undefined,
      languages: languagesParam(cfg.language)
    });
    const best = pickBest(hits, cfg.language);
    if (!best) {
      console.log(`[subtitle] no Chinese subtitle found for: ${query} (${path.basename(videoPath)})`);
      return false;
    }
    const content = await downloadSubtitle(cfg, best.fileId);
    await fs.writeFile(dest, content, 'utf-8');
    console.log(`[subtitle] downloaded ${best.language} sub for ${path.basename(videoPath)} (${best.release}, ${best.downloadCount} dl)`);
    return true;
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      console.warn('[subtitle] opensubtitles daily quota exhausted; skipping:', (e as Error).message);
    } else {
      console.warn('[subtitle] download failed for', path.basename(videoPath), '-', (e as Error).message);
    }
    return false;
  }
}
