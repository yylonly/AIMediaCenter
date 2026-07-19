// Proxy configuration & dispatcher helpers.
//
// Scope-based proxy: each external-request module (tmdb/douban/publicSites/
// ptSites) can be toggled independently. qBittorrent & Jellyfin are always
// direct (they live on the LAN). The config is stored in SystemConfig.proxy.
//
// Implementation notes (hard-won, do not simplify without re-testing):
//   - undici's ProxyAgent fails CONNECT against some proxy software (Surge)
//     with an instant ECONNRESET, so native fetch + `dispatcher` is NOT used
//     for proxied traffic. Instead, proxied requests go through
//     https-proxy-agent@7 + node:http(s).request (verified working).
//   - https-proxy-agent must be the REAL package from node_modules: webpack
//     breaks it when bundling (CONNECT handshake fails), and it hijacks any
//     recognisable `createRequire(import.meta.url)(...)` call. We therefore
//     obtain a genuine runtime require via process.getBuiltinModule('module')
//     (Node >= 20.16), which webpack's parser cannot see.
//   - keepAlive is disabled on the agent: reused CONNECT tunnels go stale on
//     some proxies and produce intermittent ECONNRESET on the next request.
//   - axios (moviedb-promise) gets the agent by patching the constructed
//     MovieDb instance (see tmdb/client.ts) because webpack bundles a
//     separate axios copy per chunk, so interceptors/defaults don't reach it.
import { prisma } from '@/lib/prisma';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

export type ProxyScope = 'tmdb' | 'douban' | 'publicSites' | 'ptSites' | 'subtitles';

export interface ProxyConfig {
  enabled: boolean;
  url: string; // e.g. http://192.168.124.1:7890
  /** When true, every scope proxies regardless of the per-scope switches. */
  global: boolean;
  scopes: {
    tmdb: boolean;
    douban: boolean;
    publicSites: boolean;
    ptSites: boolean;
    subtitles: boolean;
  };
}

const DEFAULT_CONFIG: ProxyConfig = {
  enabled: false,
  url: '',
  global: false,
  scopes: { tmdb: false, douban: false, publicSites: false, ptSites: false, subtitles: false }
};

let cachedConfig: ProxyConfig | null = null;

/** Load proxy config from DB (cached, TTL-free - invalidate via resetProxyCache). */
export async function loadProxyConfig(): Promise<ProxyConfig> {
  if (cachedConfig) return cachedConfig;
  const row = await prisma.systemConfig.findUnique({ where: { key: 'proxy' } });
  if (!row) {
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
  try {
    const v = JSON.parse(row.value) as Partial<ProxyConfig>;
    cachedConfig = {
      enabled: !!v.enabled,
      url: v.url || '',
      global: !!v.global,
      scopes: {
        tmdb: !!v.scopes?.tmdb,
        douban: !!v.scopes?.douban,
        publicSites: !!v.scopes?.publicSites,
        ptSites: !!v.scopes?.ptSites,
        subtitles: !!v.scopes?.subtitles
      }
    };
  } catch {
    cachedConfig = DEFAULT_CONFIG;
  }
  return cachedConfig;
}

/**
 * Decide whether a request should use the proxy, combining the global /
 * scope switches with an optional per-site override.
 *   - forceProxy === true:  always use proxy (per-site Site.proxy=true)
 *   - forceProxy === false: never use proxy (per-site Site.proxy=false)
 *   - forceProxy === undefined: global switch, then the scope switch
 */
async function shouldProxy(scope: ProxyScope, forceProxy?: boolean): Promise<boolean> {
  const cfg = await loadProxyConfig();
  if (!cfg.enabled || !cfg.url) return false; // master switch off -> never
  if (forceProxy === true) return true;
  if (forceProxy === false) return false;
  if (cfg.global) return true;
  return cfg.scopes[scope] === true;
}

type HpaCtor = new (url: string, opts?: Record<string, unknown>) => unknown;

let cachedHpaCtor: HpaCtor | null = null;

/**
 * Load the real https-proxy-agent constructor from node_modules.
 * See the file header for why process.getBuiltinModule is required -
 * every webpack-visible path (static import, dynamic import, createRequire
 * with literal or variable specifier) ends up with a broken or missing copy.
 */
function loadHpaCtor(): HpaCtor {
  if (cachedHpaCtor) return cachedHpaCtor;
  const { createRequire } = (process as any).getBuiltinModule(
    'module'
  ) as typeof import('node:module');
  const req = createRequire(process.cwd() + '/package.json');
  const { HttpsProxyAgent } = req('https-proxy-agent') as { HttpsProxyAgent: HpaCtor };
  cachedHpaCtor = HttpsProxyAgent;
  return HttpsProxyAgent;
}

/**
 * Return an agent that routes HTTPS traffic through the proxy via
 * https-proxy-agent@7, for axios-based clients (moviedb-promise).
 * Returns undefined when the scope is off. keepAlive stays off - see header.
 */
export async function getHttpsAgent(
  scope: ProxyScope,
  forceProxy?: boolean
): Promise<unknown | undefined> {
  if (!(await shouldProxy(scope, forceProxy))) return undefined;
  const cfg = await loadProxyConfig();
  const HttpsProxyAgent = loadHpaCtor();
  return new HttpsProxyAgent(cfg.url, { keepAlive: false });
}

/** Normalise fetch-style headers into a plain object. */
function toHeaderObject(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/** Convert the subset of BodyInit our call sites use into a Buffer. */
function toBodyBuffer(body: unknown): Buffer | null {
  if (body == null) return null;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new Error('unsupported body type for proxied fetch');
}

/** Decompress according to content-encoding (fetch does this implicitly). */
function decompress(buf: Uint8Array, encoding: string | undefined): Uint8Array {
  switch ((encoding || '').toLowerCase()) {
    case 'gzip':
      return gunzipSync(buf);
    case 'deflate':
      return inflateSync(buf);
    case 'br':
      return brotliDecompressSync(buf);
    default:
      return buf;
  }
}

/**
 * Connection-level errors worth retrying. Proxy software that rotates
 * egress nodes per connection sometimes lands on a node whose IP is
 * blocked by the destination CDN (TMDB is notorious for this) - the
 * symptomatic reset is immediate, and a fresh connection usually works.
 */
function isRetriableConnError(e: unknown): boolean {
  const msg = ((e as Error)?.message || '').toLowerCase();
  return (
    msg.includes('socket disconnected') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused')
  );
}

const MAX_PROXY_ATTEMPTS = 5;

/** HTTP status codes worth retrying: proxy egress rotation can land on
 *  nodes whose IPs are blocked by the destination (403) or rate-limited
 *  (429), and 502/503/504 are transient gateway errors. A retry on a
 *  fresh connection usually lands on a working node. */
const RETRIABLE_STATUS = new Set([403, 429, 502, 503, 504]);

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a proxied operation with retries on connection-level failures OR
 * retriable HTTP status codes. Proxy software that rotates egress nodes
 * per connection sometimes lands on a node whose IP is blocked by the
 * destination (403) or whose connection is reset (ECONNRESET) - a fresh
 * connection usually lands on a working node.
 */
export async function withProxyRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_PROXY_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      // Retry on retriable HTTP status codes (fn returns a Response).
      if (result && typeof result === 'object' && 'status' in result) {
        const status = (result as unknown as Response).status;
        if (RETRIABLE_STATUS.has(status)) {
          lastErr = new Error(`HTTP ${status}`);
          if (attempt === MAX_PROXY_ATTEMPTS) return result;
          await sleep(200 * Math.pow(2, attempt - 1));
          continue;
        }
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (!isRetriableConnError(e) || attempt === MAX_PROXY_ATTEMPTS) throw e;
      // Exponential backoff (200/400/800/1600ms): bad egress windows last
      // seconds, so spread attempts over ~3s to escape the rotation window.
      await sleep(200 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr;
}

/**
 * Minimal fetch replacement for proxied traffic, built on
 * node:http(s).request + https-proxy-agent (undici's ProxyAgent fails
 * against some proxies - see header). Follows redirects like fetch does,
 * transparently decompresses, and returns a real Response object.
 */
async function proxiedFetch(
  targetUrl: string,
  init: RequestInit,
  proxyUrl: string,
  redirects = 0
): Promise<Response> {
  const u = new URL(targetUrl);
  const isHttps = u.protocol === 'https:';
  const method = (init.method || 'GET').toUpperCase();
  const headers = toHeaderObject(init.headers);
  const body = toBodyBuffer(init.body);

  let options: Record<string, unknown>;
  if (isHttps) {
    // CONNECT tunnel via https-proxy-agent (keepAlive off, see header).
    const HttpsProxyAgent = loadHpaCtor();
    options = { method, headers, agent: new HttpsProxyAgent(proxyUrl, { keepAlive: false }) };
  } else {
    // Plain HTTP targets use the absolute-URI form against the proxy.
    const p = new URL(proxyUrl);
    headers['host'] = u.host;
    if (p.username) {
      headers['proxy-authorization'] =
        'Basic ' + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64');
    }
    options = {
      host: p.hostname,
      port: p.port || 80,
      path: u.toString(),
      method,
      headers
    };
  }

  return new Promise<Response>((resolve, reject) => {
    const handler = (res: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const status = res.statusCode || 200;
          // Follow redirects the way fetch does (303 downgrades to GET).
          const location = res.headers.location as string | undefined;
          if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 5) {
            const next = new URL(location, u).toString();
            const downgrade = status === 303 || ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD');
            resolve(
              proxiedFetch(
                next,
                downgrade ? { headers: init.headers } : init,
                proxyUrl,
                redirects + 1
              )
            );
            return;
          }
          // `any`: Buffer/Uint8Array generic variance (@types/node + TS5.7)
          // makes every precise annotation here a compile error whack-a-mole.
          let buf: any = Buffer.concat(chunks);
          buf = decompress(buf, res.headers['content-encoding'] as string | undefined);
          const outHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v == null) continue;
            if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) continue;
            if (Array.isArray(v)) v.forEach((item) => outHeaders.append(k, item));
            else outHeaders.set(k, String(v));
          }
          const nullBody = status === 204 || status === 304 || method === 'HEAD';
          resolve(
            new Response(nullBody ? null : buf, {
              status,
              statusText: res.statusMessage || '',
              headers: outHeaders
            })
          );
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    };
    const req = isHttps
      ? httpsRequest(u, options as any, handler)
      : httpRequest(options as any, handler);
    req.setTimeout(30000, () => req.destroy(new Error('proxy request timeout (30s)')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * fetch() replacement that routes through the proxy when the scope is
 * proxy-enabled (or forceProxy overrides it), and passes through to native
 * fetch unchanged otherwise.
 *
 * forceProxy: per-site override (true=always proxy, false=never, undefined=scope default)
 */
export async function fetchWithProxy(
  scope: ProxyScope,
  url: string,
  init: RequestInit & { dispatcher?: unknown } = {},
  forceProxy?: boolean
): Promise<Response> {
  if (await shouldProxy(scope, forceProxy)) {
    const cfg = await loadProxyConfig();
    // `dispatcher` in init is an undici-only option; strip it for our path.
    const { dispatcher, ...rest } = init;
    // Retry: each attempt uses a fresh connection (keepAlive off), so a
    // retry typically lands on a different egress node - see withProxyRetry.
    return withProxyRetry(() => proxiedFetch(url, rest, cfg.url));
  }
  return fetch(url, init);
}

/** Invalidate the cached config (call after settings are saved). */
export function resetProxyCache() {
  cachedConfig = null;
}
