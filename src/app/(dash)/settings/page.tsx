'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Upload, Loader2 } from 'lucide-react';

type MediaType = 'movie' | 'tv';
type MediaCategory = string;  // animation-movie | chinese-movie | foreign-movie | cn-drama | asian-drama | us-drama | cn-anime | jp-anime

interface PathRule {
  id: string;
  name: string;
  category: MediaCategory;
  transferType: string;
  containerMediaDir: string;
  hostMediaDir: string;
  containerDownloadDir: string;
  hostDownloadDir: string;
  enabled: boolean;
}
interface PathsCfg {
  deploymentMode: 'container' | 'standalone';
  rules: PathRule[];
  defaultMovieDir: string;
  defaultTvDir: string;
}

interface Cfg {
  tmdb: { apiKey: string };
  qb: { url: string; username: string; password: string; categoryMovie: string; categoryTv: string };
  jellyfin: { url: string; apiKey: string };
  paths: PathsCfg;
  naming: { movie: string; tv: string };
  proxy: {
    enabled: boolean;
    url: string;
    global: boolean;
    scopes: { tmdb: boolean; douban: boolean; publicSites: boolean; ptSites: boolean };
  };
}

const CATEGORY_OPTIONS: { value: MediaCategory; label: string; type: MediaType }[] = [
  { value: 'animation-movie', label: '动画电影', type: 'movie' },
  { value: 'chinese-movie', label: '华语电影', type: 'movie' },
  { value: 'foreign-movie', label: '外语电影', type: 'movie' },
  { value: 'cn-drama', label: '国产剧', type: 'tv' },
  { value: 'asian-drama', label: '日韩剧', type: 'tv' },
  { value: 'us-drama', label: '欧美剧', type: 'tv' },
  { value: 'cn-anime', label: '国漫', type: 'tv' },
  { value: 'jp-anime', label: '日漫', type: 'tv' }
];

const EMPTY: Cfg = {
  tmdb: { apiKey: '' },
  qb: { url: '', username: '', password: '', categoryMovie: 'movies', categoryTv: 'tv' },
  jellyfin: { url: '', apiKey: '' },
  paths: { deploymentMode: 'container', rules: [], defaultMovieDir: '/media/movies', defaultTvDir: '/media/tv' },
  naming: { movie: '', tv: '' },
  proxy: {
    enabled: false,
    url: '',
    global: false,
    scopes: { tmdb: false, douban: false, publicSites: false, ptSites: false }
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
        // Deep-merge proxy so configs saved before new fields existed still
        // pick up the defaults (e.g. `global` added later).
        // Migrate old paths shapes (flat / multi-profile) to the new
        // { deploymentMode, rules[], defaultMovieDir, defaultTvDir } shape.
        const rawPaths = d.paths || {};
        let paths: PathsCfg;
        if (Array.isArray(rawPaths.rules)) {
          // New shape.
          paths = {
            deploymentMode: rawPaths.deploymentMode === 'standalone' ? 'standalone' : 'container',
            rules: rawPaths.rules.map((r: Partial<PathRule>) => ({
              id: r.id || 'r_' + Math.random().toString(36).slice(2, 8),
              name: r.name || '',
              category: r.category || 'foreign-movie',
              transferType: r.transferType || 'link',
              containerMediaDir: r.containerMediaDir || '/media/movies',
              hostMediaDir: r.hostMediaDir || '/media/movies',
              containerDownloadDir: r.containerDownloadDir || '/downloads',
              hostDownloadDir: r.hostDownloadDir || '/downloads',
              enabled: r.enabled !== false
            })),
            defaultMovieDir: rawPaths.defaultMovieDir || '/media/movies',
            defaultTvDir: rawPaths.defaultTvDir || '/media/tv'
          };
        } else if (Array.isArray(rawPaths.profiles) && rawPaths.profiles.length > 0) {
          // Legacy multi-profile: take active profile's movie/tv as defaults.
          const prof = rawPaths.profiles.find((p: any) => p.id === rawPaths.activeId) || rawPaths.profiles[0];
          paths = {
            deploymentMode: 'container',
            rules: [],
            defaultMovieDir: prof.movie || '/media/movies',
            defaultTvDir: prof.tv || '/media/tv'
          };
        } else if (rawPaths.movie || rawPaths.tv) {
          // Legacy flat shape.
          paths = {
            deploymentMode: 'container',
            rules: [],
            defaultMovieDir: rawPaths.movie || '/media/movies',
            defaultTvDir: rawPaths.tv || '/media/tv'
          };
        } else {
          paths = { ...EMPTY.paths };
        }
        setCfg({
          ...EMPTY,
          ...d,
          paths,
          proxy: { ...EMPTY.proxy, ...(d.proxy || {}) }
        });
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

  async function testProxy() {
    const r = await fetch('/api/proxy/test', { method: 'POST' });
    const d = await r.json();
    if (d.ok) toast.success(`代理连通正常（${d.status}，${d.ms}ms）`);
    else toast.error(d.error || `代理连接失败（${d.ms || '?'}ms）`);
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

  // ---- Path rule helpers ----
  function updateRule(id: string, patch: Partial<PathRule>) {
    setCfg({
      ...cfg,
      paths: {
        ...cfg.paths,
        rules: cfg.paths.rules.map((r) => (r.id === id ? { ...r, ...patch } : r))
      }
    });
  }

  function addRule() {
    const id = 'r_' + Math.random().toString(36).slice(2, 9);
    const r: PathRule = {
      id,
      name: '',
      category: 'foreign-movie',
      transferType: 'link',
      containerMediaDir: '/media/movies',
      hostMediaDir: '/media/movies',
      containerDownloadDir: '/downloads',
      hostDownloadDir: '/downloads',
      enabled: true
    };
    setCfg({ ...cfg, paths: { ...cfg.paths, rules: [...cfg.paths.rules, r] } });
  }

  function deleteRule(id: string) {
    setCfg({ ...cfg, paths: { ...cfg.paths, rules: cfg.paths.rules.filter((r) => r.id !== id) } });
  }

  function updatePathsConfig(patch: Partial<PathsCfg>) {
    setCfg({ ...cfg, paths: { ...cfg.paths, ...patch } });
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
        <CardHeader><CardTitle>代理（HTTP/HTTPS）</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field(
            '启用代理',
            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                checked={cfg.proxy.enabled}
                onCheckedChange={(v) => setCfg({ ...cfg, proxy: { ...cfg.proxy, enabled: !!v } })}
              />
              <span className="text-sm text-muted-foreground">勾选后按下方开关生效</span>
            </div>
          )}
          {field(
            '代理地址',
            <Input
              value={cfg.proxy.url}
              onChange={(e) => setCfg({ ...cfg, proxy: { ...cfg.proxy, url: e.target.value } })}
              placeholder="http://192.168.124.1:7890"
            />
          )}
          <div className="grid grid-cols-3 items-center gap-3">
            <label className="text-sm text-muted-foreground">全局生效</label>
            <div className="col-span-2 flex items-center gap-2 pt-1">
              <Checkbox
                checked={cfg.proxy.global}
                onCheckedChange={(v) => setCfg({ ...cfg, proxy: { ...cfg.proxy, global: !!v } })}
              />
              <span className="text-sm text-muted-foreground">
                所有外网请求（TMDB/豆瓣/公开站点/PT 站点）都走代理，忽略下方单项开关
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 items-center gap-3">
            <label className="text-sm text-muted-foreground">生效范围</label>
            <div className={`col-span-2 flex flex-wrap gap-4 pt-1 text-sm ${cfg.proxy.global ? 'pointer-events-none opacity-40' : ''}`}>
              {([
                ['tmdb', 'TMDB'],
                ['douban', '豆瓣'],
                ['publicSites', '公开站点'],
                ['ptSites', 'PT 站点']
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <Checkbox
                    checked={cfg.proxy.global || cfg.proxy.scopes[key]}
                    disabled={cfg.proxy.global}
                    onCheckedChange={(v) =>
                      setCfg({
                        ...cfg,
                        proxy: { ...cfg.proxy, scopes: { ...cfg.proxy.scopes, [key]: !!v } }
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            qBittorrent 与 Jellyfin（内网）始终直连，不受代理影响。保存后立即生效。公开站点和 PT 站点可在站点管理页按站点单独开关代理（复选框"代理"）。
          </p>
          <div className="text-right">
            <Button variant="outline" size="sm" onClick={testProxy}>测试代理</Button>
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
        <CardContent className="space-y-4">
          {/* Deployment mode toggle */}
          {field(
            '部署模式',
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={cfg.paths.deploymentMode}
              onChange={(e) => updatePathsConfig({ deploymentMode: e.target.value as 'container' | 'standalone' })}
            >
              <option value="container">容器部署（app 在 docker，需容器内/外两套目录）</option>
              <option value="standalone">独立部署（app 直接装在宿主，只需一套目录）</option>
            </select>
          )}

          {/* Default fallback dirs */}
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <p className="text-sm font-medium">默认目录（匹配不到规则时用）</p>
            {field('默认电影库', <Input value={cfg.paths.defaultMovieDir} onChange={(e) => updatePathsConfig({ defaultMovieDir: e.target.value })} placeholder="/media/movies" />)}
            {field('默认剧集库', <Input value={cfg.paths.defaultTvDir} onChange={(e) => updatePathsConfig({ defaultTvDir: e.target.value })} placeholder="/media/tv" />)}
          </div>

          {/* Rules */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">分类路径规则</p>
            <Button size="sm" variant="outline" onClick={addRule}>+ 添加规则</Button>
          </div>

          {cfg.paths.rules.length === 0 && (
            <p className="text-xs text-muted-foreground">
              暂无分类规则，所有媒体整理到默认目录。点「添加规则」为华语电影、日漫等类别指定独立目录。
            </p>
          )}

          {cfg.paths.rules.map((r) => {
            const catOpt = CATEGORY_OPTIONS.find((c) => c.value === r.category);
            return (
              <div key={r.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{catOpt?.label || r.category}{r.name ? ` — ${r.name}` : ''}</span>
                  <div className="flex gap-2">
                    <Checkbox checked={r.enabled} onCheckedChange={(v) => updateRule(r.id, { enabled: !!v })} />
                    <Button size="sm" variant="ghost" onClick={() => deleteRule(r.id)}>删除</Button>
                  </div>
                </div>
                {field(
                  '媒体类别',
                  <select
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={r.category}
                    onChange={(e) => updateRule(r.id, { category: e.target.value })}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}（{c.type === 'movie' ? '电影' : '电视剧'}）</option>
                    ))}
                  </select>
                )}
                {field('备注名称', <Input value={r.name} onChange={(e) => updateRule(r.id, { name: e.target.value })} placeholder="可选，如「NAS 华语电影」" />)}
                {field(
                  '整理方式',
                  <select
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={r.transferType}
                    onChange={(e) => updateRule(r.id, { transferType: e.target.value })}
                  >
                    <option value="link">硬链接（推荐）</option>
                    <option value="softlink">软链接</option>
                    <option value="copy">复制</option>
                    <option value="move">移动</option>
                  </select>
                )}
                {cfg.paths.deploymentMode === 'container' ? (
                  <>
                    {field('容器内媒体目录', <Input value={r.containerMediaDir} onChange={(e) => updateRule(r.id, { containerMediaDir: e.target.value })} placeholder="/media/movies/华语电影" />)}
                    {field('宿主媒体目录', <Input value={r.hostMediaDir} onChange={(e) => updateRule(r.id, { hostMediaDir: e.target.value })} placeholder="/volume1/media/moive/华语电影" />)}
                    {field('容器内下载目录', <Input value={r.containerDownloadDir} onChange={(e) => updateRule(r.id, { containerDownloadDir: e.target.value })} placeholder="/downloads" />)}
                    {field('宿主下载目录', <Input value={r.hostDownloadDir} onChange={(e) => updateRule(r.id, { hostDownloadDir: e.target.value })} placeholder="/volume1/qBittorent" />)}
                  </>
                ) : (
                  <>
                    {field('媒体目录', <Input value={r.hostMediaDir} onChange={(e) => updateRule(r.id, { hostMediaDir: e.target.value })} placeholder="/media/movies/华语电影" />)}
                    {field('下载目录', <Input value={r.hostDownloadDir} onChange={(e) => updateRule(r.id, { hostDownloadDir: e.target.value })} placeholder="/downloads" />)}
                  </>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            整理时按 TMDB 元数据（类型/地区/语言/动画标签）推断媒体类别，匹配对应规则整理到指定目录。容器部署需填容器内/外两套目录（app 容器视角 + qb/媒体库视角）；独立部署只需一套。下载时会记录所用规则，编辑规则后老下载仍按原规则整理。
          </p>
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
