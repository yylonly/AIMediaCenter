'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => setCfg({ ...EMPTY, ...d }));
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

      <div className="flex justify-end">
        <Button onClick={save} disabled={loading}>{loading ? '保存中…' : '保存全部'}</Button>
      </div>
    </div>
  );
}
