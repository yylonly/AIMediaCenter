// OpenSubtitles.com REST API client (api.opensubtitles.com/api/v1).
// All traffic goes through fetchWithProxy('subtitles', ...) so it honours the
// app's proxy config (NAS has no direct route to the API).
//
// Requires a free API key (opensubtitles.com -> Settings -> API). Downloads
// work with just the key (small daily quota); supplying username/password
// raises the quota - we log in once and cache the JWT.
import { promises as fs } from 'node:fs';
import { prisma } from '@/lib/prisma';
import { fetchWithProxy } from '@/lib/proxy';

export interface SubtitleConfig {
  enabled: boolean;
  apiKey: string;
  username: string;
  password: string;
  /** 'zh-CN' | 'zh-TW' | 'both' (both = either, prefer zh-CN). */
  language: string;
  downloadOnOrganize: boolean;
}

const DEFAULT_SUBTITLE_CONFIG: SubtitleConfig = {
  enabled: false,
  apiKey: '',
  username: '',
  password: '',
  language: 'zh-CN',
  downloadOnOrganize: true
};

export async function loadSubtitleConfig(): Promise<SubtitleConfig> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'subtitle' } });
  if (!row) return { ...DEFAULT_SUBTITLE_CONFIG };
  try {
    const v = JSON.parse(row.value) as Partial<SubtitleConfig>;
    return { ...DEFAULT_SUBTITLE_CONFIG, ...v, language: v.language || 'zh-CN' };
  } catch {
    return { ...DEFAULT_SUBTITLE_CONFIG };
  }
}

const API = 'https://api.opensubtitles.com/api/v1';
const UA = 'AIMediaCenter/0.1';

/**
 * OpenSubtitles moviehash: file size + 64-bit LE sum of the first and last
 * 64KB of the file, as 16 lowercase hex digits.
 */
export async function moviehash(filePath: string): Promise<string> {
  const CHUNK = 65536;
  const st = await fs.stat(filePath);
  let hash = BigInt(st.size);
  const fh = await fs.open(filePath, 'r');
  try {
    const readChunk = async (pos: number): Promise<Buffer> => {
      const buf = Buffer.alloc(CHUNK);
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos);
      return buf.subarray(0, bytesRead);
    };
    const chunks = [await readChunk(0), await readChunk(Math.max(0, st.size - CHUNK))];
    for (const buf of chunks) {
      for (let i = 0; i + 8 <= buf.length; i += 8) {
        hash = (hash + buf.readBigUInt64LE(i)) & BigInt('0xffffffffffffffff');
      }
    }
  } finally {
    await fh.close();
  }
  return hash.toString(16).padStart(16, '0');
}

export interface OsSearchQuery {
  /** Absolute path for hash matching (skipped when falsy). */
  filePath?: string;
  /** Text query (title); used alone or as hash fallback. */
  query?: string;
  season?: number;
  episode?: number;
  /** OpenSubtitles languages filter, e.g. 'zh-CN' or 'zh-CN,zh-TW'. */
  languages: string;
}

export interface OsSubtitleHit {
  fileId: number;
  language: string;
  downloadCount: number;
  rating: number;
  release: string;
}

let jwtCache: { token: string; at: number } | null = null;
const JWT_TTL_MS = 23 * 3600 * 1000;

/** Log in with the configured account to raise the daily download quota. */
async function login(cfg: SubtitleConfig): Promise<string | null> {
  if (!cfg.username || !cfg.password) return null;
  if (jwtCache && Date.now() - jwtCache.at < JWT_TTL_MS) return jwtCache.token;
  try {
    const res = await fetchWithProxy('subtitles', `${API}/login`, {
      method: 'POST',
      headers: { 'Api-Key': cfg.apiKey, 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password })
    });
    if (!res.ok) {
      console.warn('[subtitle] opensubtitles login failed: HTTP', res.status);
      return null;
    }
    const d = (await res.json()) as { token?: string };
    if (!d.token) return null;
    jwtCache = { token: d.token, at: Date.now() };
    return d.token;
  } catch (e) {
    console.warn('[subtitle] opensubtitles login error:', (e as Error).message);
    return null;
  }
}

async function osGet(cfg: SubtitleConfig, path: string, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'Api-Key': cfg.apiKey, 'User-Agent': UA };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchWithProxy('subtitles', `${API}${path}`, { headers });
}

/** Search subtitles: hash match first, then text query as fallback. */
export async function searchSubtitles(cfg: SubtitleConfig, q: OsSearchQuery): Promise<OsSubtitleHit[]> {
  const token = await login(cfg);
  const runSearch = async (params: URLSearchParams): Promise<OsSubtitleHit[]> => {
    params.set('per_page', '5');
    params.set('order_by', 'download_count');
    params.set('order_direction', 'desc');
    const res = await osGet(cfg, `/subtitles?${params.toString()}`, token);
    if (!res.ok) {
      console.warn('[subtitle] search failed: HTTP', res.status);
      return [];
    }
    const d = (await res.json()) as { data?: Array<{ attributes?: Record<string, unknown> }> };
    const out: OsSubtitleHit[] = [];
    for (const item of d.data || []) {
      const a = item.attributes || {};
      const files = (a.files as Array<{ file_id?: number }> | undefined) || [];
      if (!files[0]?.file_id) continue;
      out.push({
        fileId: files[0].file_id,
        language: (a.language as string) || '',
        downloadCount: (a.download_count as number) || 0,
        rating: (a.ratings as number) || 0,
        release: (a.release as string) || ''
      });
    }
    return out;
  };

  if (q.filePath) {
    try {
      const hash = await moviehash(q.filePath);
      const params = new URLSearchParams({ moviehash: hash, languages: q.languages });
      const hits = await runSearch(params);
      if (hits.length > 0) return hits;
    } catch (e) {
      console.warn('[subtitle] hash search failed:', (e as Error).message);
    }
  }

  if (q.query) {
    const params = new URLSearchParams({ query: q.query, languages: q.languages });
    if (q.season != null) params.set('season_number', String(q.season));
    if (q.episode != null) params.set('episode_number', String(q.episode));
    if (q.season != null || q.episode != null) params.set('type', 'episode');
    return runSearch(params);
  }
  return [];
}

export class QuotaExceededError extends Error {}

/**
 * Connectivity test for the settings page. With account credentials it does a
 * real login and reports the remaining daily quota; with only an API key it
 * does a minimal anonymous search to validate the key. Does not touch the
 * cached JWT (tests exactly what was passed in).
 */
export async function testConnection(
  cfg: SubtitleConfig
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  if (!cfg.apiKey) return { ok: false, error: 'API Key 未填写' };
  try {
    if (cfg.username && cfg.password) {
      const res = await fetchWithProxy('subtitles', `${API}/login`, {
        method: 'POST',
        headers: { 'Api-Key': cfg.apiKey, 'User-Agent': UA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cfg.username, password: cfg.password })
      });
      if (!res.ok) {
        return { ok: false, error: `登录失败 HTTP ${res.status}（检查 API Key / 账号密码，或代理「字幕」开关）` };
      }
      const d = (await res.json()) as { token?: string };
      if (!d.token) return { ok: false, error: '登录成功但未返回 token' };
      const ui = await fetchWithProxy('subtitles', `${API}/infos/user`, {
        headers: { 'Api-Key': cfg.apiKey, 'User-Agent': UA, Authorization: `Bearer ${d.token}` }
      });
      if (ui.ok) {
        const u = (await ui.json()) as { data?: { allowed_downloads?: number; remaining?: number; level?: string } };
        const remaining = u.data?.remaining ?? u.data?.allowed_downloads;
        return { ok: true, detail: `账号 ${cfg.username} 登录正常，今日剩余下载 ${remaining ?? '?'} 次` };
      }
      return { ok: true, detail: `账号 ${cfg.username} 登录正常` };
    }
    // Anonymous mode: validate the key with a minimal search.
    const res = await fetchWithProxy(
      'subtitles',
      `${API}/subtitles?query=hello&per_page=1&languages=zh-CN`,
      { headers: { 'Api-Key': cfg.apiKey, 'User-Agent': UA } }
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `API Key 无效（HTTP ${res.status}）` };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}（检查代理「字幕」开关）` };
    return { ok: true, detail: 'API Key 有效（匿名模式，每天限 5 次下载，填账号可提额到 20 次）' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Download a subtitle file by file_id. Returns the subtitle text (utf-8).
 * Throws QuotaExceededError when the daily quota is exhausted so callers can
 * skip the rest of a batch quietly.
 */
export async function downloadSubtitle(cfg: SubtitleConfig, fileId: number): Promise<string> {
  const token = await login(cfg);
  const headers: Record<string, string> = {
    'Api-Key': cfg.apiKey,
    'User-Agent': UA,
    'Content-Type': 'application/json'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchWithProxy('subtitles', `${API}/download`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ file_id: fileId, sub_format: 'srt' })
  });
  if (res.status === 429 || res.status === 406) {
    throw new QuotaExceededError(`daily quota exhausted (HTTP ${res.status})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`download rejected (HTTP ${res.status}) - check apiKey / account credentials`);
  }
  if (!res.ok) throw new Error(`download request failed: HTTP ${res.status}`);
  const d = (await res.json()) as { link?: string; remaining?: number; message?: string };
  if (typeof d.remaining === 'number' && d.remaining <= 0) {
    throw new QuotaExceededError('daily quota exhausted (remaining=0)');
  }
  if (!d.link) throw new Error(d.message || 'no download link returned');
  const file = await fetchWithProxy('subtitles', d.link);
  if (!file.ok) throw new Error(`subtitle file fetch failed: HTTP ${file.status}`);
  return file.text();
}
