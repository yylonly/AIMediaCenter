'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { formatSize } from '@/lib/utils';
import { Pause, Play, Trash2, RefreshCw, FolderOutput, Loader2 } from 'lucide-react';

function formatRatio(uploaded: number, downloaded: number): string {
  if (downloaded === 0) return uploaded > 0 ? '∞' : '—';
  return (uploaded / downloaded).toFixed(2);
}

interface Torrent {
  hash: string;
  name: string;
  state: string;
  progress: number;
  size: number;
  downloadSpeed: number;
  uploadSpeed: number;
  uploaded: number;
  downloaded: number;
  savePath: string;
  category: string;
  eta: number;
  organized?: boolean;
}

export default function DownloadsPage() {
  const [items, setItems] = useState<Torrent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/downloads');
      const data = await res.json();
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  async function act(hash: string, action: 'pause' | 'resume' | 'remove', deleteFiles = false) {
    const res = await fetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, hash, deleteFiles })
    });
    if (res.ok) {
      toast.success('操作成功');
      reload();
    } else toast.error('操作失败');
  }

  async function organizeNow(hash: string) {
    setOrganizing((prev) => new Set(prev).add(hash));
    try {
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadHash: hash })
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        toast.success(`整理完成：${d.transferred} 个文件`);
      } else {
        toast.error(d.error || (d.errors && d.errors[0]) || '整理失败');
      }
      reload();
    } catch (e) {
      toast.error(`整理失败：${(e as Error).message}`);
    } finally {
      setOrganizing((prev) => {
        const next = new Set(prev);
        next.delete(hash);
        return next;
      });
    }
  }

  async function batchRemove() {
    if (selected.size === 0) return;
    const res = await fetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch-remove', hashes: [...selected] })
    });
    const d = await res.json();
    if (d.ok) {
      toast.success(`已删除 ${d.removed} 个种子`);
      setSelected(new Set());
      reload();
    } else toast.error('删除失败');
  }

  function toggleSelect(hash: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((t) => t.hash)));
    }
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">下载任务</h1>
          <p className="text-sm text-muted-foreground">来自 qBittorrent 的实时状态</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={batchRemove}>
              <Trash2 className="mr-2 h-4 w-4" />删除选中 ({selected.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />刷新
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{items.length} 个种子</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <Tr>
                <Th className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </Th>
                <Th>名称</Th>
                <Th>类别</Th>
                <Th>状态</Th>
                <Th>进度</Th>
                <Th>大小</Th>
                <Th>下载速度</Th>
                <Th>上传速度</Th>
                <Th>分享率</Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((t) => (
                <Tr key={t.hash}>
                  <Td>
                    <Checkbox
                      checked={selected.has(t.hash)}
                      onCheckedChange={() => toggleSelect(t.hash)}
                    />
                  </Td>
                  <Td className="max-w-md truncate" title={t.name}>{t.name}</Td>
                  <Td>{t.category || '—'}</Td>
                  <Td><Badge variant="secondary">{t.state}</Badge></Td>
                  <Td>{(t.progress * 100).toFixed(1)}%</Td>
                  <Td>{formatSize(t.size)}</Td>
                  <Td>{t.downloadSpeed > 0 ? `${formatSize(t.downloadSpeed)}/s` : '—'}</Td>
                  <Td>{t.uploadSpeed > 0 ? `${formatSize(t.uploadSpeed)}/s` : '—'}</Td>
                  <Td className="text-xs font-mono">{formatRatio(t.uploaded, t.downloaded)}</Td>
                  <Td className="flex gap-1">
                    {t.progress >= 1 && !t.organized && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="手动整理到媒体库"
                        disabled={organizing.has(t.hash)}
                        onClick={() => organizeNow(t.hash)}
                      >
                        {organizing.has(t.hash) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FolderOutput className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {t.state.includes('paused') ? (
                      <Button size="icon" variant="ghost" onClick={() => act(t.hash, 'resume')}>
                        <Play className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button size="icon" variant="ghost" onClick={() => act(t.hash, 'pause')}>
                        <Pause className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => act(t.hash, 'remove', false)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Td>
                </Tr>
              ))}
              {items.length === 0 && (
                <Tr>
                  <Td colSpan={8} className="text-center text-muted-foreground">
                    暂无下载任务（检查 qBittorrent 是否已配置连接）
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