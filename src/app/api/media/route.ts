import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { tmdbSearch, tmdbDetail, getTmdb } from '@/core/tmdb/client';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const tmdbid = url.searchParams.get('tmdbid');
  const type = url.searchParams.get('type') as 'movie' | 'tv' | null;
  try {
    const client = await getTmdb();
    if (!client) {
      return NextResponse.json({
        items: [],
        warning: '未配置 TMDB API Key（请在 /settings 或 .env 中设置 TMDB_API_KEY）'
      });
    }
    if (tmdbid && type) {
      const detail = await tmdbDetail(Number(tmdbid), type);
      if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(detail);
    }
    if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });
    const items = await tmdbSearch(q);
    return NextResponse.json({ items });
  } catch (e) {
    // TMDB not configured / rate limited / network — return empty list instead of 500
    console.warn('[api/media] failed:', (e as Error).message);
    return NextResponse.json({ items: [], warning: (e as Error).message });
  }
}
