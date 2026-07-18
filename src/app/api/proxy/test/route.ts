import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { loadProxyConfig, fetchWithProxy } from '@/lib/proxy';

/**
 * Test the configured proxy by fetching a well-known URL through it.
 * Uses google generate_204 as the default target (reachable only when the
 * proxy actually routes traffic out). Goes through the same code path as
 * real proxied traffic (fetchWithProxy with forceProxy) so the result
 * reflects what modules will actually experience.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const cfg = await loadProxyConfig();
  if (!cfg.enabled || !cfg.url) {
    return NextResponse.json({ ok: false, error: '代理未启用或未配置地址' });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get('url') || 'https://www.google.com/generate_204';

  const t0 = Date.now();
  try {
    const res = await fetchWithProxy('tmdb', target, {}, true);
    const ms = Date.now() - t0;
    return NextResponse.json({
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      ms,
      target
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: (e as Error).message,
      ms: Date.now() - t0,
      target
    });
  }
}
