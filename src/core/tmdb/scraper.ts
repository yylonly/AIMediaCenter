// Generate Kodi/Jellyfin-compatible NFO XML files.
import { create } from 'xmlbuilder2';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TmdbBrief } from './client';

function buildMovieNfo(m: TmdbBrief): string {
  const root = create({ version: '1.0', encoding: 'utf-8' }).ele('movie');
  root.ele('title').txt(m.title).up();
  if (m.originalTitle) root.ele('originaltitle').txt(m.originalTitle).up();
  if (m.year) root.ele('year').txt(m.year).up();
  if (m.overview) root.ele('plot').dat(m.overview).up().ele('outline').dat(m.overview).up();
  if (m.vote != null) root.ele('rating').txt(String(m.vote)).up();
  root.ele('uniqueid', { type: 'tmdb', default: 'true' }).txt(String(m.tmdbid)).up();
  if (m.imdbid) root.ele('uniqueid', { type: 'imdb' }).txt(m.imdbid).up();
  root.ele('tmdbid').txt(String(m.tmdbid)).up();
  return root.end({ prettyPrint: true });
}

function buildTvShowNfo(m: TmdbBrief): string {
  const root = create({ version: '1.0', encoding: 'utf-8' }).ele('tvshow');
  root.ele('title').txt(m.title).up();
  if (m.originalTitle) root.ele('originaltitle').txt(m.originalTitle).up();
  if (m.year) root.ele('year').txt(m.year).up();
  if (m.overview) root.ele('plot').dat(m.overview).up();
  if (m.vote != null) root.ele('rating').txt(String(m.vote)).up();
  root.ele('uniqueid', { type: 'tmdb', default: 'true' }).txt(String(m.tmdbid)).up();
  if (m.imdbid) root.ele('uniqueid', { type: 'imdb' }).txt(m.imdbid).up();
  root.ele('tmdbid').txt(String(m.tmdbid)).up();
  return root.end({ prettyPrint: true });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
  } catch (e) {
    console.warn('[scraper] image download failed', url, (e as Error).message);
  }
}

/**
 * Scrape a media file: emit NFO next to the file and download poster/backdrop.
 * @param mediaFile absolute path to the video file
 * @param meta TMDB brief
 */
export async function scrapeMedia(mediaFile: string, meta: TmdbBrief): Promise<void> {
  const dir = path.dirname(mediaFile);
  if (meta.type === 'movie') {
    const nfoPath = mediaFile.replace(/\.[^.]+$/, '.nfo');
    await fs.writeFile(nfoPath, buildMovieNfo(meta), 'utf-8');
    if (meta.poster) await downloadFile(meta.poster, path.join(dir, 'poster.jpg'));
    if (meta.backdrop) await downloadFile(meta.backdrop, path.join(dir, 'fanart.jpg'));
  } else {
    // tvshow.nfo lives in the show root; assume dir = "…/Show/Season X"
    const showRoot = path.dirname(dir);
    await fs.writeFile(path.join(showRoot, 'tvshow.nfo'), buildTvShowNfo(meta), 'utf-8');
    if (meta.poster) await downloadFile(meta.poster, path.join(showRoot, 'poster.jpg'));
    if (meta.backdrop) await downloadFile(meta.backdrop, path.join(showRoot, 'fanart.jpg'));
  }
}
