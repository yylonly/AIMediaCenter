'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { RefreshCw, Trash2, Search } from 'lucide-react';

interface Sub {
  id: number;
  name: string;
  year: string | null;
  type: string;
  tmdbid: number | null;
  season: number | null;
  totalEpisode: number | null;
  lackEpisode: number | null;
  state: string;
  poster: string | null;
  lastUpdate: string;
}

interface TorrentPreview {
  key: string;
  title: string;
  site: string;
  size: number;
  seeders: number;
  enclosure: string;
}

export default function SubscribesPage() {
  const [items, setItems] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalId, setModalId] = useState<number | null>(null);
  const [torrents, setTorrents] = useState<TorrentPreview[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  async function reload() {
    setLoading(true);
    const res = await fetch('/api/subscribes');
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  }
  useEffect(() => {
    reload();
  }, []);

  async function refreshAll() {
    setLoading(true);
    const res = await fetch('/api/subscribes/refresh', { method: 'POST', body: '{}' });
    const data = await res.json();
    if (res.ok) toast.success(`已提交 ${data.picked} 个种子下载`);
    else toast.error('刷新失败');
    setLoading(false);
    reload();
  }

  async function del(id: number) {
    if (!confirm('确认删除该订阅？')) return;
    const res = await fetch(`/api/subscribes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('已删除');
      reload();
    }
  }

  async function openPreview(sub: Sub) {
    setModalTitle(`${sub.name} ${sub.year || ''}`);
    setModalId(sub.id);
    setModalOpen(true);
    setTorrents([]);
    setSelected(new Set());
    setSearching(true);
    try {
      const res = await fetch(`/api/subscribes/${sub.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview' })
      });
      const d = await res.json();
      if (d.ok && d.torrents) {
        setTorrents(d.torrents);
        setSelected(new Set(d.torrents.map((t: TorrentPreview) => t.key)));
      } else {
        toast.error(d.error || '搜索失败');
      }
    } finally {
      setSearching(false);
    }
  }

  async function downloadSelected() {
    if (!modalId || selected.size === 0) return;
    const res = await fetch(`/api/subscribes/${modalId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'download', keys: [...selected] })
    });
    const d = await res.json();
    if (d.ok) {
      const msg = d.skipped ? `已下载 ${d.picked} 个，跳过 ${d.skipped} 个（已存在）` : `已下载 ${d.picked} 个种子`;
      toast.success(msg);
      setModalOpen(false);
      reload();
    } else {
      toast.error(d.error || '下载失败');
    }
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === torrents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(torrents.map((t) => t.key)));
    }
  }

  const allSelected = torrents.length > 0 && selected.size === torrents.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">订阅</h1>
          <p className="text-sm text-muted-foreground">追更影视，系统定期自动搜索并下载</p>
        </div>
        <Button variant="outline" onClick={refreshAll} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />立即搜索
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{items.length} 个订阅</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <Tr>
                <Th></Th>
                <Th>标题</Th>
                <Th>类型</Th>
                <Th>季</Th>
                <Th>进度</Th>
                <Th>状态</Th>
                <Th>最近更新</Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    {s.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.poster} alt="" className="h-12 w-8 rounded object-cover" />
                    ) : null}
                  </Td>
                  <Td>{s.name} <span className="text-muted-foreground">{s.year}</span></Td>
                  <Td><Badge variant="secondary">{s.type}</Badge></Td>
                  <Td>{s.season ? `S${String(s.season).padStart(2, '0')}` : '—'}</Td>
                  <Td>
                    {s.type === 'tv' && s.totalEpisode
                      ? `${s.totalEpisode - (s.lackEpisode ?? 0)}/${s.totalEpisode}`
                      : '—'}
                  </Td>
                  <Td><Badge>{s.state}</Badge></Td>
                  <Td className="text-xs text-muted-foreground">
                    {new Date(s.lastUpdate).toLocaleString()}
                  </Td>
                  <Td className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openPreview(s)} title="搜索并选择下载">
                      <Search className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Td>
                </Tr>
              ))}
              {items.length === 0 && (
                <Tr>
                  <Td colSpan={8} className="text-center text-muted-foreground">
                    暂无订阅。在"搜索"页找到条目后点击"订阅"。
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Search & Select Modal */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} title={modalTitle}>
        {searching ? (
          <p className="text-center text-muted-foreground py-8">搜索中...</p>
        ) : torrents.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">没有找到匹配的种子</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                全选 / 取消全选
              </label>
              <Button size="sm" onClick={downloadSelected} disabled={selected.size === 0}>
                下载选中 ({selected.size})
              </Button>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {torrents.map((t) => (
                <label
                  key={t.key}
                  className="flex items-start gap-3 p-3 rounded border hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selected.has(t.key)}
                    onCheckedChange={() => toggleSelect(t.key)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" title={t.title}>{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.site} · 种子 {t.seeders} · {(t.size / 1024 / 1024).toFixed(0)} MB
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}