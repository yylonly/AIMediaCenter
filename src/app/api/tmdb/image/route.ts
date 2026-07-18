import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { fetchWithProxy } from '@/lib/proxy';

// TMDB image proxy: image.tmdb.org is frequently blocked or unreliable from
// end-user browsers (especially in CN). The server-side host can usually
// reach it, so we fetch and stream the bytes back, same pattern as the
// Douban image proxy. Only image.tmdb.org hosts are allowed.
const ALLOWED_HOST = 'image.tmdb.org';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const target = url.searchParams.get('url');
  if (!target) return NextResponse.json({ error: 'url required' }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  if (parsed.hostname !== ALLOWED_HOST) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 });
  }

  try {
    const res = await fetchWithProxy('tmdb', parsed.toString(), {
      headers: {
        'User-Agent': UA,
        Accept: 'image/*,*/*;q=0.8'
      }
    });
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable'
      }
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
