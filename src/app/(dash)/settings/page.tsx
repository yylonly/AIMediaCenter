'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Upload, Loader2 } from 'lucide-react';

interface PathProfile {
  id: string;
  name: string;
  download: string;
  qbSavePath: string;
  movie: string;
  tv: string;
  transferType: string;
}
interface PathsCfg {
  activeId: string;
  profiles: PathProfile[];
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

const DEFAULT_PROFILE: PathProfile = {
  id: 'default',
  name: '默认',
  download: '/downloads',
  qbSavePath: '',
  movie: '/media/movies',
  tv: '/media/tv',
  transferType: 'link'
};

const EMPTY: Cfg = {
  tmdb: { apiKey: '' },
  qb: { url: '', username: '', password: '', categoryMovie: 'movies', categoryTv: 'tv' },
  jellyfin: { url: '', apiKey: '' },
  paths: { activeId: 'default', profiles: [{ ...DEFAULT_PROFILE }] },
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
  // Which profile is being edited in the paths card (defaults to the active one).
  const [editProfileId, setEditProfileId] = useState<string>('default');

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
        // Migrate old single-object paths to the multi-profile shape.
        const rawPaths = d.paths || {};
        let paths: PathsCfg;
        if (Array.isArray(rawPaths.profiles) && rawPaths.profiles.length > 0) {
          paths = {
            activeId: rawPaths.activeId || rawPaths.profiles[0].id,
            profiles: rawPaths.profiles.map((p: Partial<PathProfile>) => ({
              id: p.id || 'default',
              name: p.name || '未命名',
              download: p.download || '/downloads',
              qbSavePath: p.qbSavePath ?? '',
              movie: p.movie || '/media/movies',
              tv: p.tv || '/media/tv',
              transferType: p.transferType || 'link'
            }))
          };
        } else if (rawPaths.download || rawPaths.movie || rawPaths.tv) {
          // Old flat shape -> single default profile.
          paths = {
            activeId: 'default',
            profiles: [{
              id: 'default',
              name: '默认',
              download: rawPaths.download || '/downloads',
              qbSavePath: rawPaths.qbSavePath ?? '',
              movie: rawPaths.movie || '/media/movies',
              tv: rawPaths.tv || '/media/tv',
              transferType: rawPaths.transferType || 'link'
            }]
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
        setEditProfileId(paths.activeId);
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

  // ---- Path profile helpers ----
  const editProfile = cfg.paths.profiles.find((p) => p.id === editProfileId) || cfg.paths.profiles[0];

  function updateProfile(field: keyof PathProfile, v: string) {
    if (!editProfile) return;
    setCfg({
      ...cfg,
      paths: {
        ...cfg.paths,
        profiles: cfg.paths.profiles.map((p) => (p.id === editProfile.id ? { ...p, [field]: v } : p))
      }
    });
  }

  function addProfile() {
    const id = 'p_' + Math.random().toString(36).slice(2, 9);
    const p: PathProfile = { ...DEFAULT_PROFILE, id, name: '新配置' };
    setCfg({ ...cfg, paths: { ...cfg.paths, profiles: [...cfg.paths.profiles, p] } });
    setEditProfileId(id);
  }

  function duplicateProfile() {
    if (!editProfile) return;
    const id = 'p_' + Math.random().toString(36).slice(2, 9);
    const p: PathProfile = { ...editProfile, id, name: editProfile.name + ' 副本' };
    setCfg({ ...cfg, paths: { ...cfg.paths, profiles: [...cfg.paths.profiles, p] } });
    setEditProfileId(id);
  }

  function deleteProfile() {
    if (cfg.paths.profiles.length <= 1) return; // keep at least one
    if (!editProfile) return;
    const remaining = cfg.paths.profiles.filter((p) => p.id !== editProfile.id);
    const newActive = cfg.paths.activeId === editProfile.id ? remaining[0].id : cfg.paths.activeId;
    setCfg({ ...cfg, paths: { activeId: newActive, profiles: remaining } });
    setEditProfileId(remaining[0].id);
  }

  function setActiveProfile() {
    if (!editProfile) return;
    setCfg({ ...cfg, paths: { ...cfg.paths, activeId: editProfile.id } });
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
        <CardContent className="space-y-3">
          {/* Profile selector + actions */}
          <div className="grid grid-cols-3 items-center gap-3">
            <label className="text-sm text-muted-foreground">配置选择</label>
            <div className="col-span-2 flex flex-wrap items-center gap-2">
              <select
                className="h-9 flex-1 min-w-[160px] rounded-md border border-input bg-transparent px-3 text-sm"
                value={editProfileId}
                onChange={(e) => setEditProfileId(e.target.value)}
              >
                {cfg.paths.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.id === cfg.paths.activeId ? '（生效中）' : ''}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={setActiveProfile} disabled={editProfile?.id === cfg.paths.activeId}>
                设为生效
              </Button>
              <Button size="sm" variant="outline" onClick={addProfile}>+ 添加</Button>
              <Button size="sm" variant="outline" onClick={duplicateProfile}>复制</Button>
              <Button size="sm" variant="outline" onClick={deleteProfile} disabled={cfg.paths.profiles.length <= 1}>
                删除
              </Button>
            </div>
          </div>

          {editProfile && (
            <>
              {field('配置名称', <Input value={editProfile.name} onChange={(e) => updateProfile('name', e.target.value)} />)}
              {field(
                '下载目录',
                <Input value={editProfile.download} onChange={(e) => updateProfile('download', e.target.value)} placeholder="app 容器视角，如 /downloads" />
              )}
              {field(
                'qBittorrent 保存目录',
                <Input value={editProfile.qbSavePath} onChange={(e) => updateProfile('qbSavePath', e.target.value)} placeholder="qb 视角，NAS 套件填 /volume1/qBittorent，容器栈留空" />
              )}
              {field('电影库目录', <Input value={editProfile.movie} onChange={(e) => updateProfile('movie', e.target.value)} placeholder="整理目标，如 /media/movies" />)}
              {field('剧集库目录', <Input value={editProfile.tv} onChange={(e) => updateProfile('tv', e.target.value)} placeholder="整理目标，如 /media/tv" />)}
              {field(
                '整理模式',
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={editProfile.transferType}
                  onChange={(e) => updateProfile('transferType', e.target.value)}
                >
                  <option value="link">硬链接（推荐）</option>
                  <option value="softlink">软链接</option>
                  <option value="copy">复制</option>
                  <option value="move">移动</option>
                </select>
              )}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            支持多套路径配置，同一时间一套生效。下载目录是 app 容器视角（整理时读取源文件）；qBittorrent 保存目录是 qb 视角（提交下载时用），两者在容器栈部署时相同，NAS 套件部署时不同。下载时会记录所用配置，切换后老下载仍按原配置整理。
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
