'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Upload, Loader2 } from 'lucide-react';

interface Cfg {
  tmdb: { apiKey: string };
  qb: { url: string; username: string; password: string; categoryMovie: string; categoryTv: string };
  jellyfin: { url: string; apiKey: string };
  paths: { download: string; movie: string; tv: string; transferType: string };
  naming: { movie: string; tv: string };
}

const EMPTY: Cfg = {
  tmdb: { apiKey: '' },
  qb: { url: '', username: '', password: '', categoryMovie: 'movies', categoryTv: 'tv' },
  jellyfin: { url: '', apiKey: '' },
  paths: { download: '/downloads', movie: '/media/movies', tv: '/media/tv', transferType: 'link' },
  naming: {
    movie: '',
    tv: ''
  }
};

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Cfg>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(async (r) => {
        if (!r.ok) {
          // 401 means the cookie expired; values fall back to EMPTY defaults.
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setCfg({ ...EMPTY, ...d });
        setLoadError(null);
      })
      .catch((e) => {
        setLoadError(`配置加载失败：${e.message}。请检查登录状态后刷新页面。`);
      });
  }, []);

  async function save() {
    setLoading(true);
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    if (res.ok) toast.success('已保存');
    else toast.error('保存失败');
    setLoading(false);
  }

  async function testJellyfin() {
    const r = await fetch('/api/mediaserver/refresh?action=sync', { method: 'POST' });
    const d = await r.json();
    if (d.ok) toast.success(`Jellyfin 同步了 ${d.synced} 个条目`);
    else toast.error(d.error || 'Jellyfin 连接失败');
  }

  async function testQb() {
    const r = await fetch('/api/qb/test', { method: 'POST' });
    const d = await r.json();
    if (d.ok) toast.success(`qBittorrent 连接正常（${d.version}）`);
    else toast.error(d.error || 'qBittorrent 连接失败');
  }

  async function testTmdb() {
    const r = await fetch('/api/tmdb/test', { method: 'POST' });
    const d = await r.json();
    if (d.ok) toast.success('TMDB 连接正常');
    else toast.error(d.error || 'TMDB 连接失败');
  }

  // Change password
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);

  async function changePassword() {
    if (!pw.current || !pw.next) return toast.error('请填写当前密码和新密码');
    if (pw.next !== pw.confirm) return toast.error('两次输入的新密码不一致');
    if (pw.next.length < 6) return toast.error('新密码至少 6 位');
    setPwLoading(true);
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      toast.success('密码已修改，请重新登录');
      setPw({ current: '', next: '', confirm: '' });
      // Token remains valid; new password takes effect on next login.
    } catch (e) {
      toast.error(`修改失败：${(e as Error).message}`);
    } finally {
      setPwLoading(false);
    }
  }

  // Backup / restore
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportBackup() {
    setExporting(true);
    try {
      const res = await fetch('/api/backup');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      // Get the filename from Content-Disposition, fall back to a generic name.
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      const filename = m ? m[1] : `aimediacenter-backup-${Date.now()}.json`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('已导出配置备份');
    } catch (e) {
      toast.error(`导出失败：${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  async function importBackup(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('文件不是有效的 JSON');
      }
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const s = d.stats;
      toast.success(
        `已还原：${s.systemConfig} 项配置、${s.sites} 个站点、${s.subscribes} 条订阅、${s.users} 个用户。建议刷新页面以应用新配置。`
      );
    } catch (e) {
      toast.error(`还原失败：${(e as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function set<K extends keyof Cfg>(section: K, field: keyof Cfg[K], v: string) {
    setCfg({ ...cfg, [section]: { ...cfg[section], [field]: v } });
  }

  const field = (label: string, input: React.ReactNode) => (
    <div className="grid grid-cols-3 items-center gap-3">
      <label className="text-sm text-muted-foreground">{label}</label>
      <div className="col-span-2">{input}</div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="text-sm text-muted-foreground">配置外部服务与路径策略</p>
      </div>

      {loadError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 p-3 text-sm text-amber-700 dark:text-amber-300">
          {loadError}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>TMDB</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field(
            'API Key',
            <Input
              value={cfg.tmdb.apiKey}
              onChange={(e) => set('tmdb', 'apiKey', e.target.value)}
              placeholder="来自 https://www.themoviedb.org/settings/api"
            />
          )}
          <div className="text-right">
            <Button variant="outline" size="sm" onClick={testTmdb}>测试连接</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>qBittorrent</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('WebUI URL', <Input value={cfg.qb.url} onChange={(e) => set('qb', 'url', e.target.value)} placeholder="http://127.0.0.1:8080" />)}
          {field('用户名', <Input value={cfg.qb.username} onChange={(e) => set('qb', 'username', e.target.value)} />)}
          {field('密码', <Input type="password" value={cfg.qb.password} onChange={(e) => set('qb', 'password', e.target.value)} />)}
          {field('电影分类', <Input value={cfg.qb.categoryMovie} onChange={(e) => set('qb', 'categoryMovie', e.target.value)} />)}
          {field('剧集分类', <Input value={cfg.qb.categoryTv} onChange={(e) => set('qb', 'categoryTv', e.target.value)} />)}
          <div className="text-right">
            <Button variant="outline" size="sm" onClick={testQb}>测试连接</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Jellyfin</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('URL', <Input value={cfg.jellyfin.url} onChange={(e) => set('jellyfin', 'url', e.target.value)} placeholder="http://127.0.0.1:8096" />)}
          {field('API Key', <Input value={cfg.jellyfin.apiKey} onChange={(e) => set('jellyfin', 'apiKey', e.target.value)} />)}
          <div className="text-right">
            <Button variant="outline" size="sm" onClick={testJellyfin}>测试连接（同步媒体库）</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>路径 & 整理模式</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('下载目录', <Input value={cfg.paths.download} onChange={(e) => set('paths', 'download', e.target.value)} />)}
          {field('电影库目录', <Input value={cfg.paths.movie} onChange={(e) => set('paths', 'movie', e.target.value)} />)}
          {field('剧集库目录', <Input value={cfg.paths.tv} onChange={(e) => set('paths', 'tv', e.target.value)} />)}
          {field(
            '整理模式',
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={cfg.paths.transferType}
              onChange={(e) => set('paths', 'transferType', e.target.value)}
            >
              <option value="link">硬链接（推荐）</option>
              <option value="softlink">软链接</option>
              <option value="copy">复制</option>
              <option value="move">移动</option>
            </select>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>命名模板</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field(
            '电影',
            <Input value={cfg.naming.movie} onChange={(e) => set('naming', 'movie', e.target.value)} />
          )}
          {field(
            '剧集',
            <Input value={cfg.naming.tv} onChange={(e) => set('naming', 'tv', e.target.value)} />
          )}
          <p className="text-xs text-muted-foreground">
            支持 Nunjucks 语法，可用变量：title、year、season、episode、resourcePix、videoEncode、audioEncode、releaseGroup、fileExt、tmdbid 等。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>账号安全</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('当前密码', <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} placeholder="输入当前密码" />)}
          {field('新密码', <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="至少 6 位" />)}
          {field('确认新密码', <Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder="再次输入新密码" />)}
          <div className="text-right">
            <Button variant="outline" size="sm" onClick={changePassword} disabled={pwLoading}>
              {pwLoading ? '修改中…' : '修改密码'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>备份与恢复</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            备份包含：系统配置、站点、订阅、用户账号（含密码哈希）。还原时按唯一键合并，不会删除当前未在备份中的数据。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportBackup} disabled={exporting || importing}>
              {exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
              导出备份
            </Button>
            <Button
              variant="outline"
              disabled={exporting || importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
              还原备份
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importBackup(f);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={loading}>{loading ? '保存中…' : '保存全部'}</Button>
      </div>
    </div>
  );
}
