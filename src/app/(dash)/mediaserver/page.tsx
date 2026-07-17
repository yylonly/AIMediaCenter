'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Trash2, Server, Film, Tv, ChevronDown, ChevronRight } from 'lucide-react';
import { formatSize } from '@/lib/utils';

interface MediaItem {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  Path?: string;
}

interface Episode {
  Id: string;
  Name: string;
  Type: string;
  Path?: string;
  IndexNumber?: number;
  SeasonNumber?: number;
}

interface JfStatus {
  connected: boolean;
  url?: string;
  movieCount?: number;
  seriesCount?: number;
  error?: string;
}

export default function MediaServerPage() {
  const [status, setStatus] = useState<JfStatus | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  // Episode expansion
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [episodes, setEpisodes] = useState<Record<string, Episode[]>>({});
  const [loadingEpisodes, setLoadingEpisodes] = useState<Set<string>>(new Set());

  const loadStatus = useCallback(async () => {
    const r = await fetch('/api/mediaserver?action=status');
    const d = await r.json();
    setStatus(d);
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    params.set('page', String(page));
    params.set('pageSize', '50');
    const r = await fetch(`/api/mediaserver?${params}`);
    const d = await r.json();
    setItems(d.items || []);
    setTotal(d.total || 0);
    setLoading(false);
  }, [typeFilter, page]);

  useEffect(() => {
    loadStatus();
    loadItems();
  }, [loadStatus, loadItems]);

  async function doSync() {
    setSyncing(true);
    const r = await fetch('/api/mediaserver?action=sync');
    const d = await r.json();
    if (d.ok) {
      toast.success(`同步完成，${d.synced} 条记录`);
      loadStatus();
      loadItems();
    } else {
      toast.error(d.error || '同步失败');
    }
    setSyncing(false);
  }

  async function doRefresh() {
    const r = await fetch('/api/mediaserver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh' })
    });
    const d = await r.json();
    if (d.ok) toast.success('已触发 Jellyfin 全量扫描');
    else toast.error('刷新失败');
  }

  async function toggleExpand(itemId: string) {
    if (expanded.has(itemId)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      return;
    }
    // Fetch episodes if not cached
    if (!episodes[itemId]) {
      setLoadingEpisodes((prev) => new Set(prev).add(itemId));
      const r = await fetch(`/api/mediaserver?action=episodes&parentId=${encodeURIComponent(itemId)}`);
      const d = await r.json();
      setEpisodes((prev) => ({ ...prev, [itemId]: d.episodes || [] }));
      setLoadingEpisodes((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
    setExpanded((prev) => new Set(prev).add(itemId));
  }

  async function doDelete(itemId: string, name: string) {
    if (!confirm(`确定要删除 "${name}" 吗？此操作不可撤销。`)) return;
    const r = await fetch('/api/mediaserver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', itemId })
    });
    const d = await r.json();
    if (d.ok) {
      toast.success(`已删除：${name}`);
      loadItems();
      loadStatus();
    } else {
      toast.error(d.error || '删除失败');
    }
  }

  async function doDeleteEpisode(ep: Episode, parentId: string) {
    const label = ep.SeasonNumber != null
      ? `S${String(ep.SeasonNumber).padStart(2, '0')}E${String(ep.IndexNumber ?? '?').padStart(2, '0')} ${ep.Name}`
      : ep.Name;
    if (!confirm(`确定要删除 "${label}" 吗？此操作不可撤销。`)) return;
    const r = await fetch('/api/mediaserver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteEpisode', itemId: ep.Id })
    });
    const d = await r.json();
    if (d.ok) {
      toast.success(`已删除：${label}`);
      // Remove from local cache
      setEpisodes((prev) => ({
        ...prev,
        [parentId]: (prev[parentId] || []).filter((e) => e.Id !== ep.Id)
      }));
    } else {
      toast.error(d.error || '删除失败');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">媒体库管理</h1>
          <p className="text-sm text-muted-foreground">Jellyfin 媒体库同步与管理</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={doSync} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同步中…' : '同步'}
          </Button>
          <Button variant="outline" size="sm" onClick={doRefresh}>
            <Server className="mr-2 h-4 w-4" />
            触发扫描
          </Button>
        </div>
      </div>

      {/* Status card */}
      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              服务器状态
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-2">
                <Badge variant={status.connected ? 'success' : 'destructive'}>
                  {status.connected ? '已连接' : '未连接'}
                </Badge>
                {status.url && <span className="text-xs text-muted-foreground">{status.url}</span>}
              </div>
              {status.connected && (
                <>
                  <div className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">电影：<strong>{status.movieCount ?? '—'}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tv className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">剧集：<strong>{status.seriesCount ?? '—'}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">总计：<strong>{(status.movieCount ?? 0) + (status.seriesCount ?? 0)}</strong></span>
                  </div>
                </>
              )}
              {!status.connected && status.error && (
                <div className="col-span-3 text-sm text-red-500">{status.error}</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>媒体列表 ({total})</CardTitle>
          <div className="flex gap-2">
            <Button
              variant={typeFilter === '' ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => { setTypeFilter(''); setPage(1); }}
            >
              全部
            </Button>
            <Button
              variant={typeFilter === 'Movie' ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => { setTypeFilter('Movie'); setPage(1); }}
            >
              <Film className="mr-1 h-3 w-3" />电影
            </Button>
            <Button
              variant={typeFilter === 'Series' ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => { setTypeFilter('Series'); setPage(1); }}
            >
              <Tv className="mr-1 h-3 w-3" />剧集
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <Tr>
                <Th className="w-8"></Th>
                <Th>名称</Th>
                <Th>类型</Th>
                <Th>年份</Th>
                <Th>路径</Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((it) => {
                const isSeries = it.Type === 'Series';
                const isOpen = expanded.has(it.Id);
                const eps = episodes[it.Id] || [];
                const isLoadingEps = loadingEpisodes.has(it.Id);
return (
                <React.Fragment key={it.Id}>
                  <Tr className={isOpen ? 'border-b-0' : ''}>
                      <Td>
                        {isSeries && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => toggleExpand(it.Id)}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        )}
                      </Td>
                      <Td className="max-w-md truncate" title={it.Name}>{it.Name}</Td>
                      <Td>
                        <Badge variant={it.Type === 'Movie' ? 'default' : 'secondary'}>
                          {it.Type === 'Movie' ? '电影' : it.Type === 'Series' ? '剧集' : it.Type}
                        </Badge>
                      </Td>
                      <Td>{it.ProductionYear || '—'}</Td>
                      <Td className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={it.Path}>
                        {it.Path || '—'}
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => doDelete(it.Id, it.Name)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />删除
                        </Button>
                      </Td>
                    </Tr>
                    {/* Expanded episodes */}
                    {isSeries && isOpen && (
                      <Tr key={`${it.Id}-eps`} className="bg-muted/30">
                        <Td colSpan={6} className="p-0">
                          {isLoadingEps ? (
                            <div className="px-10 py-4 text-sm text-muted-foreground">加载中…</div>
                          ) : eps.length === 0 ? (
                            <div className="px-10 py-4 text-sm text-muted-foreground">暂未加载剧集信息</div>
                          ) : (
                            <div className="px-6 py-2">
                              <Table>
                                <THead>
                                  <Tr>
                                    <Th className="w-20">集数</Th>
                                    <Th>标题</Th>
                                    <Th>路径</Th>
                                    <Th className="w-20"></Th>
                                  </Tr>
                                </THead>
                                <TBody>
                                  {eps.map((ep) => (
                                    <Tr key={ep.Id}>
                                      <Td className="font-mono text-xs text-muted-foreground">
                                        {ep.SeasonNumber != null
                                          ? `S${String(ep.SeasonNumber).padStart(2, '0')}E${String(ep.IndexNumber ?? '?').padStart(2, '0')}`
                                          : ep.IndexNumber != null
                                            ? `E${ep.IndexNumber}`
                                            : '—'}
                                      </Td>
                                      <Td className="max-w-md truncate" title={ep.Name}>{ep.Name}</Td>
                                      <Td className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={ep.Path}>
                                        {ep.Path || '—'}
                                      </Td>
                                      <Td>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => doDeleteEpisode(ep, it.Id)}
                                        >
                                          <Trash2 className="mr-1 h-3 w-3" />删除
                                        </Button>
                                      </Td>
                                    </Tr>
                                  ))}
                                </TBody>
                              </Table>
                            </div>
                          )}
                        </Td>
                      </Tr>
                    )}
</React.Fragment>
              );
              })}
              {items.length === 0 && (
                <Tr>
                  <Td colSpan={6} className="text-center text-muted-foreground">
                    {status?.connected
                      ? '暂无媒体，点击"同步"从 Jellyfin 拉取'
                      : 'Jellyfin 未连接，请先在设置中配置'}
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
          {total > 50 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                第 {page} 页 / 共 {Math.ceil(total / 50)} 页
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= Math.ceil(total / 50)}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}