'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { formatSize } from '@/lib/utils';
import { Bookmark, Download, ChevronDown, ChevronUp, Filter, Globe, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface MediaHit {
  tmdbid: number;
  type: 'movie' | 'tv';
  title: string;
  year?: string;
  overview?: string;
  poster?: string;
}

interface TorrentItem {
  key: string;
  site: string;
  title: string;
  enclosure: string;
  size: number;
  seeders: number;
  peers: number;
  pageUrl?: string;
  imdbid?: string;
}

interface SiteOption {
  id: number;
  name: string;
  domain: string;
  publicSite: boolean;
  isActive: boolean;
}

type SortKey = 'seeders' | 'peers';
type SortDir = 'asc' | 'desc';

interface SearchSnapshot {
  q: string;
  media: MediaHit[];
  torrents: TorrentItem[];
  selMedia: MediaHit | null;
  tmdbWarn: string | null;
  searched: boolean;
  selectedSites: string[];
}

const STORAGE_KEY = 'aimc_search';

const DEFAULT_SNAPSHOT: SearchSnapshot = {
  q: '', media: [], torrents: [], selMedia: null, tmdbWarn: null, searched: false, selectedSites: []
};

function loadSnapshot(): SearchSnapshot {
  if (typeof window === 'undefined') return DEFAULT_SNAPSHOT;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SNAPSHOT, ...parsed, selectedSites: parsed.selectedSites || [] };
    }
  } catch { /* ignore */ }
  return DEFAULT_SNAPSHOT;
}

function saveSnapshot(s: SearchSnapshot) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export default function SearchPage() {
  const [snap, setSnap] = useState<SearchSnapshot>(DEFAULT_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [showSites, setShowSites] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('seeders');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // When set, triggers an automatic search once the URL keyword has been
  // hydrated into `snap.q`. Avoids stale-closure issues with doSearch().
  const [autoSearchQ, setAutoSearchQ] = useState<string | null>(null);
  // Live search progress from the streaming search endpoint.
  const [searchProgress, setSearchProgress] = useState<{
    current: number;
    total: number;
    site: string;
    found: number;
  } | null>(null);

  // Hydrate from sessionStorage on mount (client-only). Also pick up a `q`
  // query param (e.g. when arriving from the trending detail dialog) so the
  // search box is pre-filled and an auto-search is requested.
  useEffect(() => {
    const loaded = loadSnapshot();
    if (typeof window !== 'undefined') {
      const urlQ = new URLSearchParams(window.location.search).get('q')?.trim();
      if (urlQ) {
        // URL param takes priority over any stale session value so the user
        // lands on results for the item they just clicked.
        loaded.q = urlQ;
        loaded.searched = false;
        setAutoSearchQ(urlQ);
      }
    }
    setSnap(loaded);
  }, []);

  // Run the auto-search requested by the URL `q` param. Runs once after
  // hydration so snap.q is already populated for the input box; uses
  // autoSearchQ directly to avoid stale-closure reads of snap.
  useEffect(() => {
    if (!autoSearchQ) return;
    const q = autoSearchQ;
    setAutoSearchQ(null);
    let cancelled = false;
    (async () => {
      setLoading(true);
      update({ media: [], torrents: [], tmdbWarn: null, searched: true, selMedia: null });
      const siteParam =
        snap.selectedSites.length > 0 ? `&sites=${snap.selectedSites.join(',')}` : '';
      const [m, t] = await Promise.all([
        safeJson(`/api/media?q=${encodeURIComponent(q)}`, 'TMDB'),
        safeJson(`/api/search?keyword=${encodeURIComponent(q)}${siteParam}`, '站点搜索')
      ]);
      if (cancelled) return;
      update({ media: m.items || [], torrents: t.items || [], tmdbWarn: m.warning || null });
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearchQ]);

  // Fetch site list on mount
  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((data) => {
        if (data.items) setSites(data.items);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const update = useCallback((patch: Partial<SearchSnapshot>) => {
    setSnap((prev) => {
      const next = { ...prev, ...patch };
      saveSnapshot(next);
      return next;
    });
  }, []);

  const setQ = useCallback((v: string) => update({ q: v }), [update]);
  const setSelMedia = useCallback((m: MediaHit | null) => update({ selMedia: m }), [update]);

  const toggleSite = useCallback((domain: string) => {
    setSnap((prev) => {
      const selected = prev.selectedSites.includes(domain)
        ? prev.selectedSites.filter((d) => d !== domain)
        : [...prev.selectedSites, domain];
      const next = { ...prev, selectedSites: selected };
      saveSnapshot(next);
      return next;
    });
  }, []);

  const selectAllSites = useCallback(() => {
    setSnap((prev) => {
      const next = { ...prev, selectedSites: sites.map((s) => s.domain) };
      saveSnapshot(next);
      return next;
    });
  }, [sites]);

  const clearSiteSelection = useCallback(() => {
    setSnap((prev) => {
      const next = { ...prev, selectedSites: [] };
      saveSnapshot(next);
      return next;
    });
  }, []);

  async function safeJson(url: string, label: string): Promise<any> {
    try {
      const r = await fetch(url);
      const text = await r.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        console.warn(`[${label}] non-JSON response:`, text.slice(0, 200));
        return {};
      }
    } catch (e) {
      console.warn(`[${label}] fetch failed:`, e);
      toast.error(`${label} 请求失败：${(e as Error).message}`);
      return {};
    }
  }

  /**
   * Run a streaming search against /api/search/stream. Pushes live progress
   * updates to `searchProgress` and resolves with the final torrent list.
   * Falls back to the plain /api/search JSON endpoint if SSE isn't usable.
   */
  async function searchStreamSites(keyword: string, selectedSites: string[]): Promise<TorrentItem[]> {
    const siteParam = selectedSites.length > 0 ? `&sites=${selectedSites.join(',')}` : '';
    const streamUrl = `/api/search/stream?keyword=${encodeURIComponent(keyword)}${siteParam}`;
    setSearchProgress({ current: 0, total: 0, site: '', found: 0 });
    try {
      const res = await fetch(streamUrl);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let items: TorrentItem[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by a blank line; events may span chunks.
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = rawEvent
            .split('\n')
            .find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(5).trim());
          if (payload.type === 'progress') {
            setSearchProgress({
              current: payload.current,
              total: payload.total,
              site: payload.site,
              found: payload.found
            });
          } else if (payload.type === 'done') {
            items = payload.items || [];
          } else if (payload.type === 'error') {
            throw new Error(payload.error || '搜索失败');
          }
        }
      }
      return items;
    } catch (e) {
      // Fallback to the non-streaming endpoint.
      console.warn('[search] stream failed, falling back:', (e as Error).message);
      const t = await safeJson(`/api/search?keyword=${encodeURIComponent(keyword)}${siteParam}`, '站点搜索');
      return t.items || [];
    } finally {
      setSearchProgress(null);
    }
  }

  async function doSearch() {
    if (!snap.q.trim()) return;
    setLoading(true);
    update({ media: [], torrents: [], tmdbWarn: null, searched: true });
    setSelMedia(null);
    // TMDB is fast and non-streaming; run in parallel with the streaming
    // site search so the progress overlay reflects site search progress.
    const tmdbPromise = safeJson(`/api/media?q=${encodeURIComponent(snap.q)}`, 'TMDB');
    const torrents = await searchStreamSites(snap.q, snap.selectedSites);
    const m = await tmdbPromise;
    update({ media: m.items || [], torrents, tmdbWarn: m.warning || null });
    setLoading(false);
  }

  async function subscribe(m: { tmdbid: number; type: string; title: string }) {
    const res = await fetch('/api/subscribes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdbid: m.tmdbid, type: m.type })
    });
    if (res.ok) toast.success(`已订阅：${m.title}`);
    else toast.error('订阅失败');
  }

  async function download(t: TorrentItem) {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ torrent: t, media: snap.selMedia })
    });
    const data = await res.json();
    if (res.ok) toast.success('已加入下载队列');
    else toast.error(data.error || '下载失败');
  }

  const { q, media, torrents, selMedia, tmdbWarn, searched, selectedSites } = snap;

  // Client-side sorting
  const sortedTorrents = useMemo(() => {
    const arr = [...torrents];
    arr.sort((a, b) => {
      const diff = sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey];
      return diff;
    });
    return arr;
  }, [torrents, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const SortIcon = ({ active }: { active: boolean }) => {
    if (!active) return <span className="ml-0.5 text-muted-foreground/40">↕</span>;
    return sortDir === 'desc'
      ? <ChevronDown className="ml-0.5 inline h-3 w-3" />
      : <ChevronUp className="ml-0.5 inline h-3 w-3" />;
  };

  return (
    <div className="space-y-6">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-background px-10 py-8 shadow-xl">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">正在搜索，请稍候…</p>
          </div>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold">搜索</h1>
        <p className="text-sm text-muted-foreground">聚合公开站点 + TMDB 元数据</p>
      </div>
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="输入电影或剧集关键词，如 The Matrix / 庆余年"
        />
        <Button onClick={doSearch} disabled={loading}>
          {loading ? '搜索中…' : '搜索'}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowSites((v) => !v)}
          title="选择搜索站点"
        >
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {showSites && (
        <Card>
          <CardContent className="pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">
                搜索站点 {selectedSites.length > 0 && (
                  <Badge variant="secondary" className="ml-2">已选 {selectedSites.length}</Badge>
                )}
                {selectedSites.length === 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">不选 = 搜索全部</span>
                )}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={selectAllSites}>全选</Button>
                <Button size="sm" variant="ghost" onClick={clearSiteSelection}>清除</Button>
              </div>
            </div>
            {sites.length > 0 ? (
              <>
                {sites.some((s) => s.publicSite) && (
                  <div className="mb-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Globe className="h-3 w-3" /> 公开站点
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {sites.filter((s) => s.publicSite).map((s) => (
                        <label key={s.domain} className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={selectedSites.includes(s.domain)}
                            onCheckedChange={() => toggleSite(s.domain)}
                          />
                          <span className="text-sm">{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {sites.some((s) => !s.publicSite) && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Lock className="h-3 w-3" /> 私有站点
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {sites.filter((s) => !s.publicSite).map((s) => (
                        <label key={s.domain} className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={selectedSites.includes(s.domain)}
                            onCheckedChange={() => toggleSite(s.domain)}
                          />
                          <span className="text-sm">{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                暂无站点，请先前往站点管理添加
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {searched && (
        <Card>
          <CardHeader>
            <CardTitle>TMDB 匹配 ({media.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {media.length === 0 && (
              <div className="col-span-full text-sm text-muted-foreground">
                {tmdbWarn ? (
                  <>
                    TMDB 未启用或调用失败：<span className="text-amber-600">{tmdbWarn}</span>
                    <br />
                    请前往 <a href="/settings" className="underline">设置</a> 填入{' '}
                    <code className="rounded bg-muted px-1">TMDB_API_KEY</code>，或在项目根目录
                    <code className="rounded bg-muted px-1 mx-1">.env</code>
                    中配置后重启服务。种子搜索不受影响。
                  </>
                ) : (
                  <>未找到匹配的 TMDB 条目，可直接从下方种子列表选择下载。</>
                )}
              </div>
            )}
            {media.map((m) => (
              <div
                key={`${m.type}:${m.tmdbid}`}
                className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${
                  selMedia?.tmdbid === m.tmdbid ? 'ring-2 ring-primary' : 'hover:bg-accent'
                }`}
                onClick={() => setSelMedia(m)}
              >
                {m.poster && (
                  <img src={m.poster} alt="" className="h-24 w-16 rounded object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {m.title} <Badge variant="secondary">{m.type}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{m.year || '-'}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{m.overview}</div>
                  <div className="mt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        subscribe(m);
                      }}
                    >
                      <Bookmark className="mr-1 h-3 w-3" />订阅
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>种子结果 ({torrents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <Tr>
                <Th>站点</Th>
                <Th>标题</Th>
                <Th>大小</Th>
                <Th>
                  <button
                    className="inline-flex items-center hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort('seeders')}
                  >
                    做种 <SortIcon active={sortKey === 'seeders'} />
                  </button>
                </Th>
                <Th>
                  <button
                    className="inline-flex items-center hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort('peers')}
                  >
                    下载 <SortIcon active={sortKey === 'peers'} />
                  </button>
                </Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {sortedTorrents.map((t) => (
                <Tr key={t.key}>
                  <Td>
                    <Badge variant="outline">{t.site}</Badge>
                  </Td>
                  <Td className="max-w-md truncate">{t.title}</Td>
                  <Td>{formatSize(t.size)}</Td>
                  <Td className="text-green-600">{t.seeders}</Td>
                  <Td className="text-muted-foreground">{t.peers}</Td>
                  <Td>
                    <Button size="sm" onClick={() => download(t)}>
                      <Download className="mr-1 h-3 w-3" />下载
                    </Button>
                  </Td>
                </Tr>
              ))}
              {torrents.length === 0 && !loading && (
                <Tr>
                  <Td colSpan={6} className="text-center text-muted-foreground">
                    暂无结果，尝试其他关键词
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
