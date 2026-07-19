'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { RefreshCw, Trash2, Server, Film, Tv, ChevronDown, ChevronRight, FolderInput, Sparkles } from 'lucide-react';

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

interface AppConfig {
  // Multi-profile shape (full), populated from the saved config.
  paths?: { activeId?: string; profiles?: Array<{ id: string; movie?: string; tv?: string; download?: string }> };
  // Read-only snapshot of the active profile, injected by GET /api/config.
  pathsActive?: { download?: string; movie?: string; tv?: string };
}

export default function MediaServerPage() {
  const [status, setStatus] = useState<JfStatus | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set());

  // Episode expansion
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [episodes, setEpisodes] = useState<Record<string, Episode[]>>({});
  const [loadingEpisodes, setLoadingEpisodes] = useState<Set<string>>(new Set());

  // Move dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDest, setMoveDest] = useState('');
  const [config, setConfig] = useState<AppConfig>({});

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

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch('/api/config');
      const d = await r.json();
      setConfig(d || {});
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadItems();
    loadConfig();
  }, [loadStatus, loadItems, loadConfig]);

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
      // Drop episode selection for collapsed item
      const eps = episodes[itemId] || [];
      if (eps.length > 0) {
        setSelectedEpisodes((prev) => {
          const next = new Set(prev);
          for (const e of eps) next.delete(e.Id);
          return next;
        });
      }
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
      // Remove from local cache + selection
      setEpisodes((prev) => ({
        ...prev,
        [parentId]: (prev[parentId] || []).filter((e) => e.Id !== ep.Id)
      }));
      setSelectedEpisodes((prev) => {
        const next = new Set(prev);
        next.delete(ep.Id);
        return next;
      });
    } else {
      toast.error(d.error || '删除失败');
    }
  }

  // ---- Selection helpers ----
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (items.length > 0 && selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((it) => it.Id)));
    }
  }

  function toggleSelectEpisode(id: string) {
    setSelectedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- Batch operations ----
  async function batchDelete() {
    if (selected.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selected.size} 个媒体吗？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/mediaserver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch-delete', itemIds: [...selected] })
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`已删除 ${d.deleted}/${d.total} 个媒体${d.errors?.length ? `，${d.errors.length} 个失败` : ''}`);
        if (d.errors?.length) toast.error(d.errors.slice(0, 3).join('\n'));
        setSelected(new Set());
        loadItems();
        loadStatus();
      } else {
        toast.error(d.error || '批量删除失败');
      }
    } finally {
      setBusy(false);
    }
  }

  async function batchDeleteEpisodes() {
    if (selectedEpisodes.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedEpisodes.size} 个剧集吗？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/mediaserver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch-deleteEpisodes', itemIds: [...selectedEpisodes] })
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`已删除 ${d.deleted}/${d.total} 个剧集${d.errors?.length ? `，${d.errors.length} 个失败` : ''}`);
        if (d.errors?.length) toast.error(d.errors.slice(0, 3).join('\n'));
        // Purge deleted episodes from local cache
        const deleted = new Set(selectedEpisodes);
        setEpisodes((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            next[k] = next[k].filter((e) => !deleted.has(e.Id));
          }
          return next;
        });
        setSelectedEpisodes(new Set());
      } else {
        toast.error(d.error || '批量删集数失败');
      }
    } finally {
      setBusy(false);
    }
  }

  async function batchRefresh() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const r = await fetch('/api/mediaserver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch-refresh',
          itemIds: [...selected],
          recursive: true,
          replaceAll: false
        })
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`已刷新 ${d.refreshed}/${d.total} 个媒体元数据${d.errors?.length ? `，${d.errors.length} 个失败` : ''}`);
        if (d.errors?.length) toast.error(d.errors.slice(0, 3).join('\n'));
      } else {
        toast.error(d.error || '批量刷新失败');
      }
    } finally {
      setBusy(false);
    }
  }

  function openMoveDialog() {
    if (selected.size === 0) return;
    // Pre-fill destination based on item type mix
    const selectedItems = items.filter((it) => selected.has(it.Id));
    const allMovies = selectedItems.length > 0 && selectedItems.every((it) => it.Type === 'Movie');
    const allSeries = selectedItems.length > 0 && selectedItems.every((it) => it.Type === 'Series');
    if (allMovies) setMoveDest(config.pathsActive?.movie || '/media/movies');
    else if (allSeries) setMoveDest(config.pathsActive?.tv || '/media/tv');
    else setMoveDest(config.pathsActive?.movie || '/media/movies');
    setMoveOpen(true);
  }

  async function batchMove() {
    if (selected.size === 0 || !moveDest.trim()) return;
    if (!confirm(`将选中的 ${selected.size} 个媒体移动到 "${moveDest}" ？\n文件将在文件系统上物理移动，并触发媒体库重新扫描。`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/mediaserver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch-move', itemIds: [...selected], destDir: moveDest.trim() })
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`已移动 ${d.moved}/${d.total} 个媒体${d.errors?.length ? `，${d.errors.length} 个失败` : ''}`);
        if (d.errors?.length) toast.error(d.errors.slice(0, 3).join('\n'));
        setSelected(new Set());
        setMoveOpen(false);
        loadItems();
      } else {
        toast.error(d.error || '批量移动失败');
      }
    } finally {
      setBusy(false);
    }
  }

  const allSelected = items.length > 0 && selected.size === items.length;
  const hasSelection = selected.size > 0;
  const hasEpisodeSelection = selectedEpisodes.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">媒体库管理</h1>
          <p className="text-sm text-muted-foreground">Jellyfin 媒体库同步与管理</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={doSync} disabled={syncing || busy}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同步中…' : '同步'}
          </Button>
          <Button variant="outline" size="sm" onClick={doRefresh} disabled={busy}>
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
                    <span className="text-sm">电影：<strong>{status.movieCount ?? '-'}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tv className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">剧集：<strong>{status.seriesCount ?? '-'}</strong></span>
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
          <div className="flex flex-wrap gap-2">
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
          {/* Batch action toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {hasSelection && (
              <>
                <span className="text-sm text-muted-foreground mr-2">
                  已选 {selected.size} 个媒体
                </span>
                <Button variant="destructive" size="sm" onClick={batchDelete} disabled={busy}>
                  <Trash2 className="mr-1 h-3 w-3" />批量删除
                </Button>
                <Button variant="outline" size="sm" onClick={batchRefresh} disabled={busy}>
                  <Sparkles className="mr-1 h-3 w-3" />批量刷新元数据
                </Button>
                <Button variant="outline" size="sm" onClick={openMoveDialog} disabled={busy}>
                  <FolderInput className="mr-1 h-3 w-3" />批量移动
                </Button>
              </>
            )}
            {hasEpisodeSelection && (
              <>
                {hasSelection && <span className="text-muted-foreground">|</span>}
                <span className="text-sm text-muted-foreground mr-2">
                  已选 {selectedEpisodes.size} 个剧集
                </span>
                <Button variant="destructive" size="sm" onClick={batchDeleteEpisodes} disabled={busy}>
                  <Trash2 className="mr-1 h-3 w-3" />批量删集数
                </Button>
              </>
            )}
            {!hasSelection && !hasEpisodeSelection && (
              <span className="text-sm text-muted-foreground">
                勾选媒体或剧集行以启用批量操作
              </span>
            )}
          </div>

          <Table>
            <THead>
              <Tr>
                <Th className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </Th>
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
                const isSel = selected.has(it.Id);
                return (
                  <React.Fragment key={it.Id}>
                    <Tr className={isOpen ? 'border-b-0' : ''}>
                      <Td>
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={() => toggleSelect(it.Id)}
                        />
                      </Td>
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
                      <Td>{it.ProductionYear || '-'}</Td>
                      <Td className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={it.Path}>
                        {it.Path || '-'}
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
                        <Td colSpan={7} className="p-0">
                          {isLoadingEps ? (
                            <div className="px-10 py-4 text-sm text-muted-foreground">加载中…</div>
                          ) : eps.length === 0 ? (
                            <div className="px-10 py-4 text-sm text-muted-foreground">暂无剧集</div>
                          ) : (
                            <div className="px-6 py-2">
                              <Table>
                                <THead>
                                  <Tr>
                                    <Th className="w-10">
                                      <Checkbox
                                        checked={eps.length > 0 && eps.every((e) => selectedEpisodes.has(e.Id))}
                                        onCheckedChange={(chk) => {
                                          setSelectedEpisodes((prev) => {
                                            const next = new Set(prev);
                                            if (chk) for (const e of eps) next.add(e.Id);
                                            else for (const e of eps) next.delete(e.Id);
                                            return next;
                                          });
                                        }}
                                      />
                                    </Th>
                                    <Th className="w-20">集数</Th>
                                    <Th>标题</Th>
                                    <Th>路径</Th>
                                    <Th className="w-20"></Th>
                                  </Tr>
                                </THead>
                                <TBody>
                                  {eps.map((ep) => (
                                    <Tr key={ep.Id}>
                                      <Td>
                                        <Checkbox
                                          checked={selectedEpisodes.has(ep.Id)}
                                          onCheckedChange={() => toggleSelectEpisode(ep.Id)}
                                        />
                                      </Td>
                                      <Td className="font-mono text-xs text-muted-foreground">
                                        {ep.SeasonNumber != null
                                          ? `S${String(ep.SeasonNumber).padStart(2, '0')}E${String(ep.IndexNumber ?? '?').padStart(2, '0')}`
                                          : ep.IndexNumber != null
                                            ? `E${ep.IndexNumber}`
                                            : '-'}
                                      </Td>
                                      <Td className="max-w-md truncate" title={ep.Name}>{ep.Name}</Td>
                                      <Td className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={ep.Path}>
                                        {ep.Path || '-'}
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
                  <Td colSpan={7} className="text-center text-muted-foreground">
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

      {/* Move dialog */}
      <Dialog open={moveOpen} onClose={() => setMoveOpen(false)} title="批量移动到新目录">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            将选中的 <strong>{selected.size}</strong> 个媒体文件移动到新目录。系统将在文件系统上物理移动文件（保留原文件名），并触发媒体库重新扫描。
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">目标目录</label>
            <Input
              value={moveDest}
              onChange={(e) => setMoveDest(e.target.value)}
              placeholder="/media/movies 或 /media/tv"
              className="font-mono"
            />
            <div className="flex flex-wrap gap-2">
              {config.pathsActive?.movie && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMoveDest(config.pathsActive!.movie!)}
                >
                  <Film className="mr-1 h-3 w-3" />电影库：{config.pathsActive.movie}
                </Button>
              )}
              {config.pathsActive?.tv && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMoveDest(config.pathsActive!.tv!)}
                >
                  <Tv className="mr-1 h-3 w-3" />剧集库：{config.pathsActive.tv}
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 p-3 text-xs text-amber-700 dark:text-amber-300">
            注意：移动操作不可撤销。若目标与源位于不同文件系统，可能因跨设备限制失败。
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setMoveOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button size="sm" onClick={batchMove} disabled={busy || !moveDest.trim()}>
              {busy ? '移动中…' : '确认移动'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
