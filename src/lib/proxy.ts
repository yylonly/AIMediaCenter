// Proxy configuration & dispatcher helpers.
//
// Scope-based proxy: each external-request module (tmdb/douban/publicSites/
// ptSites) can be toggled independently. qBittorrent & Jellyfin are always
// direct (they live on the LAN). The config is stored in SystemConfig.proxy.
//
// Two injection paths:
//   - Native fetch (undici): pass `dispatcher` in the fetch options. Use
//     `fetchWithProxy(scope, url, init)` to do this automatically.
//   - axios (moviedb-promise): pass `httpsAgent`. Use `getHttpsAgent(scope)`.
//
// A global EnvHttpProxyAgent is also set in instrumentation.ts as a fallback
// for any fetch that isn't explicitly wrapped; NO_PROXY keeps LAN traffic
// direct.
//
// NOTE on imports: dynamic `await import()` is unreliable inside Next.js
// server bundles (webpack's namespace interop can strip constructors, and
// node: builtins lose their exports). We therefore use static imports here;
// for the CJS-only https-proxy-agent we go through createRequire, which
// resolves the real package from node_modules at runtime.
import { prisma } from '@/lib/prisma';
import { createRequire } from 'node:module';
import { ProxyAgent } from 'undici';

export type ProxyScope = 'tmdb' | 'douban' | 'publicSites' | 'ptSites';

export interface ProxyConfig {
  enabled: boolean;
  url: string; // e.g. http://192.168.124.1:7890
  scopes: {
    tmdb: boolean;
    douban: boolean;
    publicSites: boolean;
    ptSites: boolean;
  };
}

const DEFAULT_CONFIG: ProxyConfig = {
  enabled: false,
  url: '',
  scopes: { tmdb: false, douban: false, publicSites: false, ptSites: false }
};

let cachedConfig: ProxyConfig | null = null;
// The undici ProxyAgent is lazily created and memoised per proxy URL.
let cachedAgent: ProxyAgent | null = null;
let cachedAgentUrl = '';

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
      scopes: {
        tmdb: !!v.scopes?.tmdb,
        douban: !!v.scopes?.douban,
        publicSites: !!v.scopes?.publicSites,
        ptSites: !!v.scopes?.ptSites
      }
    };
  } catch {
    cachedConfig = DEFAULT_CONFIG;
  }
  return cachedConfig;
}

/** Whether a given scope should go through the proxy right now. */
async function scopeEnabled(scope: ProxyScope): Promise<boolean> {
  const cfg = await loadProxyConfig();
  if (!cfg.enabled || !cfg.url) return false;
  return cfg.scopes[scope] === true;
}

/**
 * Decide whether a request should use the proxy, combining the scope switch
 * with an optional per-site override.
 *   - forceProxy === true:  always use proxy (per-site Site.proxy=true)
 *   - forceProxy === false: never use proxy (per-site Site.proxy=false)
 *   - forceProxy === undefined: fall back to the scope switch
 */
async function shouldProxy(scope: ProxyScope, forceProxy?: boolean): Promise<boolean> {
  const cfg = await loadProxyConfig();
  if (!cfg.enabled || !cfg.url) return false; // master switch off -> never
  if (forceProxy === true) return true;
  if (forceProxy === false) return false;
  return cfg.scopes[scope] === true;
}

/**
 * Return an undici ProxyAgent for the given scope, or undefined if the scope
 * is not proxy-enabled. The agent is memoised per URL.
 *
 * forceProxy overrides the scope switch (see shouldProxy).
 */
export async function getDispatcher(
  scope: ProxyScope,
  forceProxy?: boolean
): Promise<ProxyAgent | undefined> {
  if (!(await shouldProxy(scope, forceProxy))) return undefined;
  const cfg = await loadProxyConfig();
  if (cachedAgent && cachedAgentUrl === cfg.url) return cachedAgent;
  cachedAgent = new ProxyAgent({ uri: cfg.url });
  cachedAgentUrl = cfg.url;
  return cachedAgent;
}

/**
 * Return an https.Agent (HttpsProxyAgent) configured to route through the
 * proxy, for axios-based clients (moviedb-promise). axios's built-in `proxy`
 * option breaks HTTPS-over-HTTP-proxy with ECONNRESET against some proxy
 * software (Surge/ClashX), so we must use https-proxy-agent which handles
 * the CONNECT handshake properly. Returns undefined when the scope is off.
 *
 * Loads the CJS package via createRequire - webpack's module interop can't be
 * trusted for it (the named export is assigned in a way cjs-module-lexer can
 * miss). Must be v7+: axios 1.x is incompatible with https-proxy-agent@5
 * (socket disconnected before TLS), so it's pinned as a direct dependency
 * instead of relying on axios's transitive v5.
 */
export async function getHttpsAgent(
  scope: ProxyScope,
  forceProxy?: boolean
): Promise<unknown | undefined> {
  if (!(await shouldProxy(scope, forceProxy))) return undefined;
  const cfg = await loadProxyConfig();
  const req = createRequire(import.meta.url);
  // Non-literal specifier on purpose: webpack statically rewrites
  // createRequire(...)('literal') into a bundled copy, and the bundled
  // https-proxy-agent fails the CONNECT handshake (fast ECONNRESET).
  // Loading through a variable forces a real runtime require, which
  // resolves the actual v7 package from node_modules (verified working).
  const pkg = 'https-proxy-agent';
  const { HttpsProxyAgent } = req(pkg) as {
    HttpsProxyAgent: new (url: string) => unknown;
  };
  return new HttpsProxyAgent(cfg.url);
}

/**
 * fetch() wrapper that attaches the proxy dispatcher when the scope is
 * proxy-enabled (or when forceProxy overrides it), and passes through
 * unchanged otherwise. The dispatcher key is the undici-native way to
 * override the global agent per request.
 *
 * forceProxy: per-site override (true=always proxy, false=never, undefined=scope default)
 */
export async function fetchWithProxy(
  scope: ProxyScope,
  url: string,
  init: RequestInit & { dispatcher?: unknown } = {},
  forceProxy?: boolean
): Promise<Response> {
  const dispatcher = await getDispatcher(scope, forceProxy);
  // `dispatcher` is an undici option not in the lib.dom typings; cast through any.
  return fetch(url, { ...init, dispatcher } as any) as Promise<Response>;
}

/** Invalidate the cached config & agent (call after settings are saved). */
export function resetProxyCache() {
  cachedConfig = null;
  cachedAgent = null;
  cachedAgentUrl = '';
}
