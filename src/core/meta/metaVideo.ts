// Filename → MetaInfo parser, ported (loosely) from MoviePilot's app/core/meta/metavideo.py
// Uses a token-based state machine that walks through common release-name tokens
// (year → resolution → season/episode → codec → group).

import type { MetaInfo, MediaType } from './types';

const RE_YEAR = /^(19\d{2}|20\d{2})$/;
const RE_YEAR_RANGE = /^\d{4}-\d{4}$/;
const RE_RES = /^(\d{3,4}p|4k|2160p|1080p|720p|480p)$/i;
const RE_SEASON = /^s(\d{1,3})$/i;
const RE_EPISODE = /^ep?(\d{1,4})$/i;
const RE_SEASON_EPISODE = /^s(\d{1,3})e(\d{1,4})$/i;
const RE_SEASON_MULTI_EPISODE = /^s(\d{1,3})e(\d{1,4})-e?(\d{1,4})$/i;
const RE_SEASON_RANGE = /^s(\d{1,3})-s?(\d{1,3})$/i;
const RE_EPISODE_RANGE = /^ep?(\d{1,4})-ep?(\d{1,4})$/i;
const RE_PART = /^(cd|dvd|part|pt)(\d+)$/i;
const RE_VCODEC = /^(x264|x265|h\.?264|h\.?265|hevc|avc|10bit|8bit)$/i;
const RE_ACODEC_SINGLE = /^(flac|aac|ac3|truehd|atmos|dts|dts-hd|dts-hdma|ddp|dd|ddp5\.1|dd5\.1)$/i;
const RE_RESOURCE_TYPE = /^(bluray|blu-ray|webrip|web-dl|webdl|hdtv|dvdrip|hdrip|remux|uhd)$/i;
const RE_EFFECT = /^(hdr10\+?|hdr|dv|dovi|dolby|atmos|3d|imax|edition|extended|proper)$/i;
const RE_CHINESE = /[\u4e00-\u9fa5]/;
const RE_CN_SEASON = /第\s?([一二三四五六七八九十百零两0-9]+)\s?[季部]/;
const RE_CN_SEASON_ALL = /全\s?([一二三四五六七八九十百零两0-9]+)\s?[季部]/;
const RE_CN_EPISODE = /第\s?([一二三四五六七八九十百零两0-9]+)\s?[集话話]/;
const RE_CN_EPISODE_ALL = /全\s?([一二三四五六七八九十百零两0-9]+)\s?[集话話]/;
const RE_TRAILING_GROUP = /-([A-Za-z0-9@!]+)$/;
const RE_BRACKET_GROUP = /\[([^\]]+)\]/g;
const RE_EXT = /\.([a-z0-9]{2,4})$/i;

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100
};

function cnToNum(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let unit = 1;
  let current = 0;
  for (const ch of text) {
    const v = CN_NUM[ch];
    if (v === undefined) continue;
    if (v >= 10) {
      if (current === 0) current = 1;
      total += current * v;
      current = 0;
      unit = v;
    } else {
      current = current * 10 + v;
    }
  }
  return total + current;
}

function isAllChinese(s: string): boolean {
  const cn = s.match(/[\u4e00-\u9fa5]/g)?.length || 0;
  const alnum = s.match(/[A-Za-z0-9]/g)?.length || 0;
  return cn > 0 && cn >= alnum;
}

function tokenize(name: string): string[] {
  // Preserve consecutive dots (avoid greedy split) but treat . _ space as boundaries.
  // Parentheses are unwrapped so tokens like "(1080p)" become "1080p".
  return name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/[._ ]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

export function parseFilename(input: string): MetaInfo {
  const original = input;
  let name = input;

  // Strip extension
  let fileExt: string | undefined;
  const extMatch = name.match(RE_EXT);
  if (extMatch) {
    fileExt = '.' + extMatch[1].toLowerCase();
    name = name.slice(0, -(extMatch[0].length));
  }

  // Extract Chinese-style season/episode from raw string BEFORE tokenizing
  let cnSeasonBegin: number | undefined;
  let cnEpisodeBegin: number | undefined;
  let totalEpisode: number | undefined;
  const mCnSeason = name.match(RE_CN_SEASON);
  if (mCnSeason) cnSeasonBegin = cnToNum(mCnSeason[1]);
  const mCnSeasonAll = name.match(RE_CN_SEASON_ALL);
  if (mCnSeasonAll && !cnSeasonBegin) cnSeasonBegin = 1;
  const mCnEp = name.match(RE_CN_EPISODE);
  if (mCnEp) cnEpisodeBegin = cnToNum(mCnEp[1]);
  const mCnEpAll = name.match(RE_CN_EPISODE_ALL);
  if (mCnEpAll) totalEpisode = cnToNum(mCnEpAll[1]);

  // Bracketed groups often carry the release group in anime releases
  const bracketGroups: string[] = [];
  let bm: RegExpExecArray | null;
  while ((bm = RE_BRACKET_GROUP.exec(name)) !== null) bracketGroups.push(bm[1]);

  // Trailing "-GROUP"
  let resourceTeam: string | undefined;
  const trail = name.match(RE_TRAILING_GROUP);
  if (trail) {
    resourceTeam = trail[1];
    name = name.slice(0, -trail[0].length);
  } else if (bracketGroups.length > 0) {
    resourceTeam = bracketGroups[0].trim();
  }

  const tokens = tokenize(name);

  let year: string | undefined;
  let seasonBegin: number | undefined;
  let seasonEnd: number | undefined;
  let episodeBegin: number | undefined;
  let episodeEnd: number | undefined;
  let part: string | undefined;
  let resourcePix: string | undefined;
  let resourceType: string | undefined;
  let videoEncode: string | undefined;
  let audioEncode: string | undefined;
  const resourceEffect: string[] = [];

  const nameTokens: string[] = [];
  let stopName = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // Skip trailing-group leftover
    if (RE_YEAR.test(t)) {
      if (!year) year = t;
      stopName = true;
      continue;
    }
    if (RE_YEAR_RANGE.test(t)) {
      if (!year) year = t.split('-')[0];
      stopName = true;
      continue;
    }
    const mSE = t.match(RE_SEASON_MULTI_EPISODE);
    if (mSE) {
      seasonBegin ||= Number(mSE[1]);
      episodeBegin ||= Number(mSE[2]);
      episodeEnd = Number(mSE[3]);
      stopName = true;
      continue;
    }
    const mSEs = t.match(RE_SEASON_EPISODE);
    if (mSEs) {
      seasonBegin ||= Number(mSEs[1]);
      episodeBegin ||= Number(mSEs[2]);
      stopName = true;
      continue;
    }
    const mSR = t.match(RE_SEASON_RANGE);
    if (mSR) {
      seasonBegin ||= Number(mSR[1]);
      seasonEnd = Number(mSR[2]);
      stopName = true;
      continue;
    }
    const mS = t.match(RE_SEASON);
    if (mS) {
      seasonBegin ||= Number(mS[1]);
      stopName = true;
      continue;
    }
    const mER = t.match(RE_EPISODE_RANGE);
    if (mER) {
      episodeBegin ||= Number(mER[1]);
      episodeEnd = Number(mER[2]);
      stopName = true;
      continue;
    }
    const mE = t.match(RE_EPISODE);
    if (mE) {
      episodeBegin ||= Number(mE[1]);
      stopName = true;
      continue;
    }
    if (RE_RES.test(t)) {
      resourcePix ||= t.toLowerCase().replace('4k', '2160p');
      stopName = true;
      continue;
    }
    if (RE_RESOURCE_TYPE.test(t)) {
      resourceType ||= t.replace(/[-.]/g, '').toUpperCase();
      stopName = true;
      continue;
    }
    // WEB + DL handled by combined token, but also try 2-token join
    if (/^web$/i.test(t) && tokens[i + 1] && /^(dl|rip)$/i.test(tokens[i + 1])) {
      resourceType ||= ('WEB-' + tokens[i + 1]).toUpperCase();
      i++;
      stopName = true;
      continue;
    }
    if (RE_EFFECT.test(t)) {
      resourceEffect.push(t.toUpperCase());
      stopName = true;
      continue;
    }
    if (RE_VCODEC.test(t)) {
      videoEncode ||= t.toUpperCase();
      stopName = true;
      continue;
    }
    if (RE_ACODEC_SINGLE.test(t)) {
      audioEncode ||= t.toUpperCase();
      stopName = true;
      continue;
    }
    const mPart = t.match(RE_PART);
    if (mPart) {
      part = t.toUpperCase();
      stopName = true;
      continue;
    }

    if (!stopName) {
      nameTokens.push(t);
    }
  }

  // Fallback: extract 4-digit anywhere if year not found
  if (!year) {
    const y = original.match(/(19\d{2}|20\d{2})/);
    if (y) year = y[1];
  }

  // Split cn/en names
  const rawName = nameTokens.join(' ').trim();
  let cnName: string | undefined;
  let enName: string | undefined;
  if (rawName) {
    if (isAllChinese(rawName)) cnName = rawName;
    else {
      // If mixed, split by first ASCII
      const idx = rawName.search(/[A-Za-z0-9]/);
      if (idx > 0 && RE_CHINESE.test(rawName.slice(0, idx))) {
        cnName = rawName.slice(0, idx).trim();
        enName = rawName.slice(idx).trim();
      } else {
        enName = rawName;
      }
    }
  }

  // Apply Chinese-derived season/episode
  if (cnSeasonBegin !== undefined) seasonBegin ??= cnSeasonBegin;
  if (cnEpisodeBegin !== undefined) episodeBegin ??= cnEpisodeBegin;

  const type: MediaType =
    seasonBegin !== undefined || episodeBegin !== undefined || totalEpisode !== undefined
      ? 'tv'
      : year
        ? 'movie'
        : 'unknown';

  const title = cnName || enName || original;

  return {
    original,
    cnName,
    enName,
    title,
    year,
    type,
    seasonBegin,
    seasonEnd,
    episodeBegin,
    episodeEnd,
    part,
    resourcePix,
    resourceType,
    resourceEffect: resourceEffect.length ? resourceEffect : undefined,
    videoEncode,
    audioEncode,
    resourceTeam,
    fileExt
  };
}
