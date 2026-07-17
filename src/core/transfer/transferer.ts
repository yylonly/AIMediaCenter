// File transfer engine: hardlink / softlink / copy / move.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type TransferMode = 'link' | 'softlink' | 'copy' | 'move';

/**
 * Transfer a file. Creates parent directories, ignores existing identical link.
 */
export async function transferFile(
  src: string,
  dest: string,
  mode: TransferMode
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });

  // If dest exists — decide policy.
  try {
    const s = await fs.lstat(dest);
    if (s) {
      // Same file already? For hardlink, inode comparison suffices.
      if (mode === 'link') {
        const srcStat = await fs.stat(src);
        const destStat = await fs.stat(dest);
        if (srcStat.ino === destStat.ino) return;
      }
      // Otherwise remove the old one
      await fs.rm(dest, { force: true });
    }
  } catch {
    /* not exists, continue */
  }

  switch (mode) {
    case 'link':
      try {
        await fs.link(src, dest);
      } catch (e) {
        // Fall back to copy across filesystems
        if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
          await fs.copyFile(src, dest);
        } else throw e;
      }
      break;
    case 'softlink':
      await fs.symlink(src, dest);
      break;
    case 'copy':
      await fs.copyFile(src, dest);
      break;
    case 'move':
      try {
        await fs.rename(src, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
          await fs.copyFile(src, dest);
          await fs.rm(src, { force: true });
        } else throw e;
      }
      break;
  }
}

const VIDEO_EXT = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.m2ts',
  '.ts',
  '.webm',
  '.rmvb',
  '.iso'
]);
const SUBTITLE_EXT = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt']);

/** Walk a directory recursively and yield all video files. */
export async function* walkVideos(dir: string): AsyncGenerator<string> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.name.startsWith('.') || ent.name === '@eaDir' || ent.name === '#recycle') continue;
    if (ent.isDirectory()) {
      yield* walkVideos(full);
    } else if (ent.isFile() && VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) {
      yield full;
    }
  }
}

/**
 * Locate accompanying subtitles for a given video file (same basename, common subtitle exts).
 * Also matches Chinese-locale variants like `.chs.srt`, `.zh.ass`.
 */
export async function findSubtitles(videoPath: string): Promise<string[]> {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith(base) && SUBTITLE_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(dir, f));
}
