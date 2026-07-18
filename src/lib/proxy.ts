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
import { prisma } from '@/lib/prisma';

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
// undici ProxyAgent is lazily created (dynamic import keeps it out of the
// client bundle and avoids loading undici on the browser edge).
let cachedAgent: Promise<unknown> | null = null;
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
 * Return an undici ProxyAgent for the given scope, or undefined if the scope
 * is not proxy-enabled. The agent is memoised per URL.
 */
export async function getDispatcher(scope: ProxyScope): Promise<unknown | undefined> {
  if (!(await scopeEnabled(scope))) return undefined;
  const cfg = await loadProxyConfig();
  if (cachedAgent && cachedAgentUrl === cfg.url) return cachedAgent;
  // Dynamic import: undici is Node-only and shouldn't be in the edge bundle.
  const { ProxyAgent } = await import('undici');
  cachedAgent = Promise.resolve(new ProxyAgent({ uri: cfg.url }));
  cachedAgentUrl = cfg.url;
  return cachedAgent;
}

/**
 * Return axios-native proxy config for moviedb-promise. axios 1.x supports a
 * `proxy` option (host/port/protocol) without needing any agent package.
 * Returns undefined when the scope is not proxy-enabled.
 */
export async function getAxiosProxyConfig(
  scope: ProxyScope
): Promise<{ host: string; port: number; protocol: string } | undefined> {
  if (!(await scopeEnabled(scope))) return undefined;
  const cfg = await loadProxyConfig();
  try {
    const u = new URL(cfg.url);
    return {
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      protocol: u.protocol.replace(':', '')
    };
  } catch {
    return undefined;
  }
}

/**
 * fetch() wrapper that attaches the proxy dispatcher when the scope is
 * proxy-enabled, and passes through unchanged otherwise. The dispatcher key
 * is the undici-native way to override the global agent per request.
 */
export async function fetchWithProxy(
  scope: ProxyScope,
  url: string,
  init: RequestInit & { dispatcher?: unknown } = {}
): Promise<Response> {
  const dispatcher = await getDispatcher(scope);
  // `dispatcher` is an undici option not in the lib.dom typings; cast through any.
  return fetch(url, { ...init, dispatcher } as any) as Promise<Response>;
}

/** Invalidate the cached config & agent (call after settings are saved). */
export function resetProxyCache() {
  cachedConfig = null;
  cachedAgent = null;
  cachedAgentUrl = '';
}
