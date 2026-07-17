import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { tmdbTrending, tmdbPopular, tmdbTopRated } from '@/core/tmdb/client';
import { doubanHot, type DoubanTag } from '@/core/douban/client';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const source = url.searchParams.get('source') || 'tmdb';
  // `type` is the canonical type param; `media` is kept as an alias for TMDB
  // backward-compat. For `source=douban`, the frontend sends `type=movie|tv`.
  const typeParam = url.searchParams.get('type');
  const mediaParam = url.searchParams.get('media');
  const media = (mediaParam || typeParam || 'movie') as 'movie' | 'tv';
  const timeWindow = (url.searchParams.get('window') as 'day' | 'week') || 'week';
  const tag = (url.searchParams.get('tag') as DoubanTag) || '热门';

  // Douban source
  if (source === 'douban') {
    const items = await doubanHot(media, tag);
    return NextResponse.json({ items });
  }

  // TMDB source (default) - use `type` for the TMDB endpoint selector.
  const type = typeParam || 'trending';
  let items;
  switch (type) {
    case 'trending':
      items = await tmdbTrending(timeWindow);
      break;
    case 'popular':
      items = await tmdbPopular(media);
      break;
    case 'toprated':
      items = await tmdbTopRated(media);
      break;
    default:
      return NextResponse.json({ error: `unknown type: ${type}` }, { status: 400 });
  }

  return NextResponse.json({ items });
}
