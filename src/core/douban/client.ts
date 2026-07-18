// Douban (豆瓣) unofficial JSON API client.
// Endpoint: https://movie.douban.com/j/search_subjects
// No auth required, but needs a browser-like User-Agent.
import { LRUCache } from 'lru-cache';
import { fetchWithProxy } from '@/lib/proxy';

const cache = new LRUCache<string, any>({ max: 100, ttl: 60 * 60 * 1000 });

const BASE = 'https://movie.douban.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DoubanBrief {
  doubanId: string;
  type: 'movie' | 'tv';
  title: string;
  poster?: string;
  vote?: number;
  url?: string;
  year?: string;
}

/** Known-good Douban browse tags (verified against the live API). */
export type DoubanTag =
  | '热门'
  | '豆瓣高分'
  | '国产剧'
  | '美剧'
  | '日剧'
  | '韩剧'
  | '英剧'
  | '港剧'
  | '日本动画'
  | '综艺'
  | '纪录片';

interface RawSubject {
  id: string;
  title: string;
  cover?: string;
  rate?: string; // e.g. "8.5" or "" for unrated
  url?: string;
  episodes_info?: string;
  playable?: boolean;
  is_new?: boolean;
}

/**
 * Fetch Douban subjects for a given type + tag.
 *
 * Tag taxonomy (verified against the live API):
 * - movie: 热门, 豆瓣高分
 * - tv:    热门, 国产剧, 美剧, 日剧, 韩剧, 英剧, 港剧, 日本动画, 综艺, 纪录片
 *
 * Note: `tv` + `豆瓣高分` returns empty - Douban's TV browse page has no
 * high-score filter, only 热门 + regional/genre categories. Use the
 * regional tags for TV instead.
 *
 * @param type  movie | tv
 * @param tag   one of the tags above
 */
export async function doubanHot(
  type: 'movie' | 'tv',
  tag: DoubanTag = '热门'
): Promise<DoubanBrief[]> {
  const key = `douban:${type}:${tag}`;
  const cached = cache.get(key) as DoubanBrief[] | undefined;
  if (cached) return cached;

  const url = new URL(`${BASE}/j/search_subjects`);
  url.searchParams.set('type', type);
  url.searchParams.set('tag', tag);
  url.searchParams.set('page_limit', '20');
  url.searchParams.set('page_start', '0');

  try {
    const res = await fetchWithProxy('douban', url.toString(), {
      headers: {
        'User-Agent': UA,
        Referer: `${BASE}/`,
        Accept: 'application/json, text/plain, */*'
      }
    });
    if (!res.ok) {
      console.warn('[douban] HTTP', res.status);
      return [];
    }
    const data = (await res.json()) as { subjects?: RawSubject[] };
    const items = (data.subjects || [])
      .filter((s) => s.id && s.title)
      .map((s) => mapSubject(s, type));
    cache.set(key, items);
    return items;
  } catch (e) {
    console.warn('[douban] fetch failed:', (e as Error).message);
    return [];
  }
}

function mapSubject(s: RawSubject, type: 'movie' | 'tv'): DoubanBrief {
  const rateStr = (s.rate || '').trim();
  const vote = /^\d+(\.\d+)?$/.test(rateStr) ? Number(rateStr) : undefined;
  // Year is not in the list payload; left undefined (search page resolves it).
  return {
    doubanId: s.id,
    type,
    title: s.title,
    poster: s.cover,
    vote,
    url: s.url
  };
}

/** Reset cache (after config changes or manual refresh). */
export function resetDoubanCache() {
  cache.clear();
}
