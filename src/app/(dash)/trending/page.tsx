'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Bookmark, Loader2, Star, Film, Tv, Search, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface MediaItem {
  source: 'tmdb' | 'douban';
  tmdbid?: number;
  doubanId?: string;
  type: 'movie' | 'tv';
  title: string;
  year?: string;
  poster?: string;
  vote?: number;
}

/** Enriched detail shown in the dialog (overview + extra metadata).
 *  Mirrors the subset of TmdbBrief returned by /api/media?tmdbid=&type=. */
interface MediaDetail {
  title: string;
  overview?: string;
  year?: string;
  poster?: string;
  vote?: number;
  type: 'movie' | 'tv';
  originalTitle?: string;
  totalEpisodes?: number;
  seasons?: { season: number; episodeCount: number; airDate?: string }[];
}

interface TabDef {
  key: string;
  label: string;
  api: string;
  source: 'tmdb' | 'douban';
}

// Sub-tabs grouped by source. Douban is the default top-level selection.
// Labels omit the source prefix since the top-level switch already conveys it.
const DOUBAN_TABS: TabDef[] = [
  { key: 'douban_hot_movie', label: '热门电影', api: '/api/trending?source=douban&type=movie&tag=热门', source: 'douban' },
  { key: 'douban_hot_tv', label: '热门剧集', api: '/api/trending?source=douban&type=tv&tag=热门', source: 'douban' },
  { key: 'douban_top_movie', label: '高分电影', api: '/api/trending?source=douban&type=movie&tag=豆瓣高分', source: 'douban' },
  // TV has no "豆瓣高分" tag in Douban's API; use regional tags instead.
  { key: 'douban_cn_tv', label: '国产剧', api: '/api/trending?source=douban&type=tv&tag=国产剧', source: 'douban' },
  { key: 'douban_us_tv', label: '美剧', api: '/api/trending?source=douban&type=tv&tag=美剧', source: 'douban' },
  { key: 'douban_anime_tv', label: '日本动画', api: '/api/trending?source=douban&type=tv&tag=日本动画', source: 'douban' }
];

const TMDB_TABS: TabDef[] = [
  { key: 'trending', label: '热门趋势', api: '/api/trending?type=trending&window=week', source: 'tmdb' },
  { key: 'popular_movie', label: '流行电影', api: '/api/trending?type=popular&media=movie', source: 'tmdb' },
  { key: 'popular_tv', label: '流行剧集', api: '/api/trending?type=popular&media=tv', source: 'tmdb' },
  { key: 'toprated_movie', label: '高分电影', api: '/api/trending?type=toprated&media=movie', source: 'tmdb' },
  { key: 'toprated_tv', label: '高分剧集', api: '/api/trending?type=toprated&media=tv', source: 'tmdb' }
];

const SUB_TABS: Record<'douban' | 'tmdb', TabDef[]> = {
  douban: DOUBAN_TABS,
  tmdb: TMDB_TABS
};

/**
 * Route a poster URL through the matching server-side image proxy so it
 * renders in the browser regardless of CDN reachability:
 *  - doubanio.com needs a movie.douban.com Referer (else HTTP 418)
 *  - image.tmdb.org is frequently blocked from end-user browsers
 * Non-proxied (e.g. relative) URLs pass through unchanged.
 */
function proxyPoster(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('doubanio.com')) {
      return `/api/douban/image?url=${encodeURIComponent(url)}`;
    }
    if (parsed.hostname === 'image.tmdb.org') {
      return `/api/tmdb/image?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // relative URL - return as-is
  }
  return url;
}

export default function TrendingPage() {
  const router = useRouter();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  // Top-level source switch; Douban is the default.
  const [source, setSource] = useState<'douban' | 'tmdb'>('douban');
  // Sub-tab key within the active source.
  const [activeTab, setActiveTab] = useState<string>('douban_hot_movie');

  // Detail dialog state
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null);
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchItems = useCallback(async (api: string, src: 'tmdb' | 'douban') => {
    setLoading(true);
    try {
      const res = await fetch(api);
      const data = await res.json();
      if (data.items) {
        // Normalize: tag each item with its source. TMDB items lack a `source`
        // field in the API response; Douban items lack `tmdbid`. Frontend
        // derives source from the active tab so both render uniformly.
        const normalized: MediaItem[] = data.items.map((it: any) => ({
          source: src,
          tmdbid: it.tmdbid,
          doubanId: it.doubanId,
          type: it.type === 'tv' ? 'tv' : 'movie',
          title: it.title,
          year: it.year,
          poster: proxyPoster(it.poster),
          vote: typeof it.vote === 'number' ? it.vote : undefined
        }));
        setItems(normalized);
      } else if (data.error) {
        toast.error(data.error);
        setItems([]);
      } else {
        setItems([]);
      }
    } catch (e) {
      toast.error('获取榜单失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Default load: Douban first sub-tab.
    const first = DOUBAN_TABS[0];
    setActiveTab(first.key);
    fetchItems(first.api, first.source);
  }, [fetchItems]);

  const switchSubTab = (tab: TabDef) => {
    setActiveTab(tab.key);
    fetchItems(tab.api, tab.source);
  };

  const switchSource = (src: 'douban' | 'tmdb') => {
    if (src === source) return;
    setSource(src);
    const first = SUB_TABS[src][0];
    setActiveTab(first.key);
    fetchItems(first.api, first.source);
  };

  // Open the detail dialog. Fetches TMDB detail to show overview/metadata.
  // For Douban items (no tmdbid), first resolve the tmdbid via search,
  // then fetch detail. Falls back to the card summary if TMDB misses.
  const openDetail = async (item: MediaItem) => {
    setDetailItem(item);
    setDetail(null);
    setDetailLoading(true);
    try {
      let tmdbid = item.tmdbid;
      let type = item.type;

      if (!tmdbid) {
        // Douban item: resolve tmdbid by title.
        const r = await fetch(`/api/media?q=${encodeURIComponent(item.title)}`);
        const d = await r.json();
        const hit = d.items?.[0];
        if (hit?.tmdbid) {
          tmdbid = hit.tmdbid;
          type = hit.type === 'tv' ? 'tv' : 'movie';
        }
      }

      if (tmdbid) {
        const r = await fetch(`/api/media?tmdbid=${tmdbid}&type=${type}`);
        if (r.ok) {
          const d = (await r.json()) as MediaDetail;
          // Proxy the TMDB poster URL (image.tmdb.org is often blocked from
          // browsers); fall back to the card's already-proxied poster.
          setDetail({
            ...d,
            type,
            poster: proxyPoster(d.poster) || item.poster,
            title: d.title || item.title
          });
          return;
        }
      }
      // No TMDB match: show the card summary as the detail.
      setDetail({
        title: item.title,
        year: item.year,
        poster: item.poster,
        vote: item.vote,
        type: item.type,
        overview: '暂无详细简介（未匹配到 TMDB 条目）。'
      });
    } catch {
      setDetail({
        title: item.title,
        year: item.year,
        poster: item.poster,
        vote: item.vote,
        type: item.type,
        overview: '加载详情失败。'
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailItem(null);
    setDetail(null);
  };

  const searchFromDetail = () => {
    if (!detailItem) return;
    router.push(`/search?q=${encodeURIComponent(detailItem.title)}`);
  };

  const subscribe = async (item: MediaItem) => {
    const key = `${item.source}:${item.type}:${item.tmdbid || item.doubanId}`;
    setSubscribing(key);
    try {
      let tmdbid = item.tmdbid;
      let type = item.type;

      // Douban items have no tmdbid - resolve via TMDB search first.
      if (!tmdbid) {
        const r = await fetch(`/api/media?q=${encodeURIComponent(item.title)}`);
        const d = await r.json();
        const hit = d.items?.[0];
        if (!hit?.tmdbid) {
          toast.error('未在 TMDB 找到匹配条目，无法订阅');
          return;
        }
        tmdbid = hit.tmdbid;
        type = hit.type === 'tv' ? 'tv' : 'movie';
      }

      const res = await fetch('/api/subscribes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbid, type })
      });
      if (res.ok) toast.success(`已订阅：${item.title}`);
      else {
        const data = await res.json();
        toast.error(data.error || '订阅失败');
      }
    } catch {
      toast.error('订阅失败');
    } finally {
      setSubscribing(null);
    }
  };

  // Subscribe from within the dialog. Uses the resolved detail (tmdbid)
  // if available to avoid re-resolving.
  const subscribeFromDetail = async () => {
    if (!detailItem) return;
    const item: MediaItem = {
      ...detailItem,
      // Prefer the tmdbid/type resolved by openDetail (mirrored via detail.type).
      tmdbid: detailItem.tmdbid,
      type: detail?.type || detailItem.type
    };
    await subscribe(item);
  };

  const subtitle = source === 'douban' ? '豆瓣热门推荐' : 'TMDB 热门影视推荐';
  const subTabs = SUB_TABS[source];

  // Subscribe button label state inside the dialog
  const dialogSubKey = detailItem
    ? `${detailItem.source}:${detailItem.type}:${detailItem.tmdbid || detailItem.doubanId}`
    : null;
  const isDialogSubscribing = dialogSubKey ? subscribing === dialogSubKey : false;

  return (
    <div className="space-y-6">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-background px-10 py-8 shadow-xl">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">加载中…</p>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold">推荐资源榜</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {/* Top-level source switch */}
      <div className="flex gap-2">
        <Button
          variant={source === 'douban' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchSource('douban')}
        >
          豆瓣推荐
        </Button>
        <Button
          variant={source === 'tmdb' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchSource('tmdb')}
        >
          TMDB 推荐
        </Button>
      </div>

      {/* Sub-tab bar (filtered by active source) */}
      <div className="flex flex-wrap gap-2">
        {subTabs.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => switchSubTab(tab)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Grid */}
      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item, idx) => {
            const key = `${item.source}:${item.type}:${item.tmdbid || item.doubanId}`;
            const isSubscribing = subscribing === key;
            return (
              <Card
                key={key}
                className="cursor-pointer overflow-hidden transition hover:ring-2 hover:ring-primary"
                onClick={() => openDetail(item)}
              >
                <CardContent className="p-0">
                  {/* Poster */}
                  <div className="relative aspect-[2/3] w-full bg-muted">
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt={item.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        {item.type === 'movie' ? <Film className="h-8 w-8" /> : <Tv className="h-8 w-8" />}
                      </div>
                    )}
                    {/* Rank badge */}
                    <div className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white">
                      #{idx + 1}
                    </div>
                    {/* Rating badge */}
                    {item.vote ? (
                      <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-yellow-400">
                        <Star className="h-3 w-3 fill-current" />
                        {item.vote.toFixed(1)}
                      </div>
                    ) : null}
                  </div>
                  {/* Info */}
                  <div className="space-y-1 p-2">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{item.year || '-'}</span>
                      <Badge variant={item.type === 'movie' ? 'secondary' : 'outline'} className="text-xs">
                        {item.type === 'movie' ? '电影' : '剧集'}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={isSubscribing}
                      onClick={(e) => {
                        e.stopPropagation();
                        subscribe(item);
                      }}
                    >
                      {isSubscribing ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Bookmark className="mr-1 h-3 w-3" />
                      )}
                      订阅
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        !loading && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12">
              <p className="text-sm text-muted-foreground">
                {source === 'tmdb' ? (
                  <>
                    未获取到榜单数据，请确认已在
                    <a href="/settings" className="mx-1 underline">设置</a>
                    中配置 TMDB API Key。
                  </>
                ) : (
                  '未获取到豆瓣榜单数据，豆瓣服务可能暂时不可用。'
                )}
              </p>
            </CardContent>
          </Card>
        )
      )}

      {/* Detail dialog */}
      <Dialog
        open={!!detailItem}
        onClose={closeDetail}
        title={detailItem?.title}
        className="max-w-3xl"
      >
        {detailLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* Poster */}
            <div className="mx-auto w-40 shrink-0 sm:mx-0">
              <div className="aspect-[2/3] w-full overflow-hidden rounded bg-muted">
                {detail.poster ? (
                  <img
                    src={detail.poster}
                    alt={detail.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    {detail.type === 'movie' ? <Film className="h-10 w-10" /> : <Tv className="h-10 w-10" />}
                  </div>
                )}
              </div>
            </div>

            {/* Meta + overview + actions */}
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={detail.type === 'movie' ? 'secondary' : 'outline'}>
                  {detail.type === 'movie' ? '电影' : '剧集'}
                </Badge>
                {detail.year && (
                  <span className="text-sm text-muted-foreground">{detail.year}</span>
                )}
                {typeof detail.vote === 'number' && detail.vote > 0 && (
                  <span className="flex items-center gap-1 text-sm text-yellow-500">
                    <Star className="h-4 w-4 fill-current" />
                    {detail.vote.toFixed(1)}
                  </span>
                )}
                {detail.type === 'tv' && detail.seasons && detail.seasons.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {detail.seasons.length} 季
                  </span>
                )}
                {detail.type === 'tv' && detail.totalEpisodes && (
                  <span className="text-sm text-muted-foreground">{detail.totalEpisodes} 集</span>
                )}
              </div>

              {detail.originalTitle && detail.originalTitle !== detail.title && (
                <p className="text-sm text-muted-foreground">原名：{detail.originalTitle}</p>
              )}

              <p className="text-sm leading-relaxed text-foreground/90">
                {detail.overview || '暂无简介。'}
              </p>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={searchFromDetail}>
                  <Search className="mr-1 h-4 w-4" />
                  搜索资源
                </Button>
                <Button
                  variant="outline"
                  disabled={isDialogSubscribing}
                  onClick={subscribeFromDetail}
                >
                  {isDialogSubscribing ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Bookmark className="mr-1 h-4 w-4" />
                  )}
                  订阅
                </Button>
                {detailItem?.source === 'douban' && (
                  <a
                    href={`https://www.douban.com/search?q=${encodeURIComponent(detail.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: 'ghost' }))}
                  >
                    <ExternalLink className="mr-1 h-4 w-4" />
                    豆瓣页面
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
