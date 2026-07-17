import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';

// Douban image proxy: doubanio.com refuses requests without a Referer
// header (returns HTTP 418). Browsers may strip Referer due to
// Referrer-Policy, so we fetch server-side and stream the bytes back.
// Only doubanio.com hosts are allowed to prevent open-proxy abuse.
const ALLOWED_HOSTS = ['img9.doubanio.com', 'img3.doubanio.com', 'img2.doubanio.com', 'img1.doubanio.com', 'img.doubanio.com'];
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
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 });
  }

  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': UA,
        Referer: 'https://movie.douban.com/',
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
