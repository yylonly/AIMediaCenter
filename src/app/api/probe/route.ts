import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { fetchWithProxy } from '@/lib/proxy';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { url, scope = 'publicSites', forceProxy = true } = await req.json();
  try {
    const res = await fetchWithProxy(scope, url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    }, forceProxy);
    const text = await res.text();
    console.log('[probe]', url, 'status', res.status, 'len', text.length, 'head', text.slice(0, 200));
    return NextResponse.json({ status: res.status, len: text.length, head: text.slice(0, 800) });
  } catch (e) {
    console.log('[probe] ERR', url, (e as Error).message);
    return NextResponse.json({ error: (e as Error).message, stack: (e as Error).stack?.slice(0, 500) });
  }
}
