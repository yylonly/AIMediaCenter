// qBittorrent adapter — uses @ctrl/qbittorrent
import { QBittorrent } from '@ctrl/qbittorrent';
import { prisma } from '@/lib/prisma';
import { fetchWithProxy } from '@/lib/proxy';

/** Convert a Base32 string (RFC 4648) to lowercase hex. Used for BitTorrent info hashes. */
function base32ToHex(b32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = b32.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  // Process 8 chars at a time -> 5 bytes
  for (let i = 0; i < cleaned.length; i += 8) {
    const chunk = cleaned.slice(i, i + 8);
    let buffer = 0;
    let bitsLeft = 0;
    for (const ch of chunk) {
      const val = alphabet.indexOf(ch);
      if (val < 0) continue;
      buffer = (buffer << 5) | val;
      bitsLeft += 5;
      if (bitsLeft >= 8) {
        bytes.push((buffer >> (bitsLeft - 8)) & 0xff);
        bitsLeft -= 8;
      }
    }
  }
  return Buffer.from(bytes).toString('hex');
}

export interface QbConfig {
  url: string;
  username: string;
  password: string;
  categoryMovie: string;
  categoryTv: string;
}

let cached: { cfg: QbConfig; client: QBittorrent } | null = null;

export async function getQbConfig(): Promise<QbConfig | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'qb' } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as QbConfig;
  } catch {
    return null;
  }
}

export async function getQb(): Promise<QBittorrent | null> {
  const cfg = await getQbConfig();
  if (!cfg?.url) return null;
  if (cached && cached.cfg.url === cfg.url && cached.cfg.username === cfg.username) {
    return cached.client;
  }
  const client = new QBittorrent({
    baseUrl: cfg.url,
    username: cfg.username,
    password: cfg.password
  });
  cached = { cfg, client };
  return client;
}

export interface AddTorrentOpts {
  savepath?: string;
  category?: string;
  tags?: string[];
  paused?: boolean;
  /** Extra headers (Cookie/UA/Referer) for authenticated .torrent downloads (PT sites). */
  headers?: Record<string, string>;
}

/**
 * Fetch a .torrent file from a URL, handling NexusPHP download notice redirects.
 *
 * NexusPHP sites redirect first-time downloads to downloadnotice.php, which shows
 * a confirmation page. We detect this redirect, POST the confirmation form, and
 * follow the resulting redirect back to download.php with the &letdown=1 flag
 * that bypasses the notice on subsequent downloads.
 *
 * Returns the raw torrent file Buffer, or null on failure.
 */
async function fetchTorrentFile(
  enclosure: string,
  headers?: Record<string, string>
): Promise<Buffer | null> {
  const fetchOpts: RequestInit = headers ? { headers } : {};
  fetchOpts.redirect = 'manual';

  let res = await fetchWithProxy('ptSites', enclosure, fetchOpts);

  // Handle redirect to downloadnotice.php (NexusPHP first-download confirmation)
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    if (/downloadnotice\.php/i.test(loc)) {
      const noticeUrl = loc.startsWith('http') ? loc : new URL(loc, enclosure).href;
      // Extract torrent id from the original download URL
      const idMatch = enclosure.match(/[?&]id=(\d+)/);
      const torrentId = idMatch ? idMatch[1] : '';
      const referer = enclosure.replace(/[?&].*/, '');

      // POST the confirmation form to dismiss the notice
      const noticeRes = await fetchWithProxy('ptSites', noticeUrl, {
        method: 'POST',
        headers: {
          ...(headers || {}),
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: noticeUrl
        },
        body: new URLSearchParams({
          id: torrentId,
          type: 'firsttime',
          hidenotice: '1',
          submit: '下载种子文件'
        }).toString(),
        redirect: 'manual'
      });

      // The notice POST redirects back to download.php?...&letdown=1
      if (noticeRes.status >= 300 && noticeRes.status < 400) {
        const dlLoc = noticeRes.headers.get('location') || '';
        if (dlLoc) {
          const dlUrl = dlLoc.startsWith('http') ? dlLoc : new URL(dlLoc, enclosure).href;
          const dlRes = await fetchWithProxy('ptSites', dlUrl, fetchOpts);
          if (dlRes.ok) return Buffer.from(await dlRes.arrayBuffer());
        }
      }
      // If POST returned the file directly
      if (noticeRes.ok) return Buffer.from(await noticeRes.arrayBuffer());
      return null;
    }
    // Other redirects: follow once (e.g. http->https, or letdown redirect)
    if (res.status === 302 || res.status === 301) {
      const loc2 = res.headers.get('location') || '';
      if (loc2) {
        const followUrl = loc2.startsWith('http') ? loc2 : new URL(loc2, enclosure).href;
        const r2 = await fetchWithProxy('ptSites', followUrl, fetchOpts);
        if (r2.ok) return Buffer.from(await r2.arrayBuffer());
      }
    }
    return null;
  }

  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** Fetch a .torrent URL or magnet and add to qB. Returns torrent hash (best-effort). */
export async function addTorrent(
  enclosure: string,
  opts: AddTorrentOpts = {}
): Promise<{ ok: boolean; hash?: string; error?: string }> {
  const qb = await getQb();
  if (!qb) return { ok: false, error: 'qBittorrent not configured' };

  try {
    if (enclosure.startsWith('magnet:')) {
      await qb.addMagnet(enclosure, {
        savepath: opts.savepath,
        category: opts.category,
        paused: opts.paused ? 'true' : 'false',
        tags: (opts.tags || []).join(',')
      } as any);
      // Extract info hash - supports both hex (40 chars) and Base32 (32 chars) formats
      const hashMatch = enclosure.match(/xt=urn:btih:([0-9a-zA-Z]{32,40})/);
      let hash: string | undefined;
      if (hashMatch) {
        const raw = hashMatch[1];
        if (/^[0-9a-fA-F]{40}$/.test(raw)) {
          // Hex format (v1)
          hash = raw.toLowerCase();
        } else if (/^[A-Z2-7]{32}$/i.test(raw)) {
          // Base32 format - convert to hex
          hash = base32ToHex(raw);
        } else {
          hash = raw.toLowerCase();
        }
      }
      return { ok: true, hash };
    }
    // Fetch torrent file - attach auth headers when provided (PT sites need cookie/passkey)
    const buf = await fetchTorrentFile(enclosure, opts.headers);
    if (!buf) return { ok: false, error: '下载种子文件失败（未获取到有效内容）' };
    // Sanity check: bencode files start with 'd' (0x64)
    if (buf[0] !== 0x64) {
      return { ok: false, error: '下载的内容不是有效的种子文件（可能需要重新登录站点）' };
    }
    // Prefer file-based add so qB derives the hash for us
    await qb.addTorrent(new Uint8Array(buf) as any, {
      savepath: opts.savepath,
      category: opts.category,
      paused: opts.paused ? 'true' : 'false',
      tags: (opts.tags || []).join(',')
    } as any);
    // Compute hash via parse-torrent for cross-referencing
    let hash: string | undefined;
    try {
      // Dynamic import so we can keep it out of the browser bundle
      const parseTorrent = (await import('parse-torrent')).default as any;
      const parsed = await parseTorrent(new Uint8Array(buf));
      hash = parsed?.infoHash?.toLowerCase();
    } catch {
      /* ignore */
    }
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface QbTorrent {
  hash: string;
  name: string;
  state: string;
  progress: number; // 0..1
  size: number;
  downloadSpeed: number;
  uploadSpeed: number;
  uploaded: number;    // total bytes uploaded
  downloaded: number;  // total bytes downloaded
  savePath: string;
  contentPath: string; // absolute path to the torrent content (file or folder)
  category: string;
  tags: string;
  addedOn: number;
  completionOn: number;
  eta: number;
}

export async function listTorrents(filter?: {
  category?: string;
  status?: 'completed' | 'downloading' | 'all';
}): Promise<QbTorrent[]> {
  const qb = await getQb();
  if (!qb) return [];
  try {
    const res: any[] = await (qb as any).listTorrents({
      filter: filter?.status && filter.status !== 'all' ? filter.status : undefined,
      category: filter?.category
    });
    return (res || []).map((t) => ({
      hash: (t.hash || '').toLowerCase(),
      name: t.name,
      state: t.state,
      progress: t.progress,
      size: t.size,
      downloadSpeed: t.dlspeed,
      uploadSpeed: t.upspeed,
      uploaded: t.uploaded || 0,
      downloaded: t.downloaded || 0,
      savePath: t.save_path,
      contentPath: t.content_path || `${t.save_path}/${t.name}`,
      category: t.category,
      tags: t.tags,
      addedOn: t.added_on,
      completionOn: t.completion_on,
      eta: t.eta
    }));
  } catch (e) {
    console.warn('[qb] list failed', (e as Error).message);
    return [];
  }
}

export async function listTorrentFiles(hash: string): Promise<
  { name: string; size: number; progress: number }[]
> {
  const qb = await getQb();
  if (!qb) return [];
  try {
    const files: any[] = await (qb as any).torrentFiles(hash);
    return (files || []).map((f) => ({ name: f.name, size: f.size, progress: f.progress }));
  } catch (e) {
    console.warn('[qb] files failed', (e as Error).message);
    return [];
  }
}

export async function pauseTorrent(hash: string) {
  const qb = await getQb();
  if (!qb) return false;
  try {
    await (qb as any).pauseTorrent(hash);
    return true;
  } catch {
    return false;
  }
}

export async function resumeTorrent(hash: string) {
  const qb = await getQb();
  if (!qb) return false;
  try {
    await (qb as any).resumeTorrent(hash);
    return true;
  } catch {
    return false;
  }
}

export async function removeTorrent(hash: string, deleteFiles = false) {
  const qb = await getQb();
  if (!qb) return false;
  try {
    await (qb as any).removeTorrent(hash, deleteFiles);
    return true;
  } catch {
    return false;
  }
}

/** Lightweight connectivity check: fetch the qBittorrent app version. */
export async function testQb(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const qb = await getQb();
  if (!qb) return { ok: false, error: 'qBittorrent 未配置' };
  try {
    const version = await qb.version();
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
