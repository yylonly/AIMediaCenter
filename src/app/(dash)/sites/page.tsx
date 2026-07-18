'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Play, RefreshCcw, Plus, Trash2, Globe, Lock, LogIn } from 'lucide-react';

interface Site {
  id: number;
  name: string;
  domain: string;
  url: string;
  pri: number;
  isActive: boolean;
  publicSite: boolean;
  cookie: string | null;
  ua: string | null;
  passkey: string | null;
  proxy: boolean;
  note: string | null;
}

interface TestResult {
  domain: string;
  ok: boolean;
  error?: string;
  elapsed?: number;
  results?: number;
  sample?: Array<{ title: string; seeders: number }>;
}

const STORAGE_KEY = 'aimc_site_test_results';

function loadResults(): Record<string, TestResult> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveResults(r: Record<string, TestResult>) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

const EMPTY_FORM = {
  name: '',
  domain: '',
  url: '',
  pri: 1,
  publicSite: false,
  username: '',
  password: '',
  cookie: '',
  ua: '',
  passkey: '',
  proxy: false,
  note: ''
};

export default function SitesPage() {
  const [items, setItems] = useState<Site[]>([]);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(() => loadResults());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  // Captcha dialog state
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captchaSessionId, setCaptchaSessionId] = useState('');
  const [captchaSubmitting, setCaptchaSubmitting] = useState(false);

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    setTestResults(loadResults());
  }, []);

  const updateResults = useCallback((patch: Record<string, TestResult>) => {
    setTestResults((prev) => {
      const next = { ...prev, ...patch };
      saveResults(next);
      return next;
    });
  }, []);

  async function reload() {
    const r = await fetch('/api/sites');
    const d = await r.json();
    setItems(d.items || []);
  }

  useEffect(() => {
    reload();
  }, []);

  const toggle = useCallback(async (s: Site) => {
    const r = await fetch(`/api/sites/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !s.isActive })
    });
    if (r.ok) {
      toast.success(`已${!s.isActive ? '启用' : '禁用'}`);
      reload();
    }
  }, []);

  const testSite = useCallback(async (s: Site) => {
    setTesting((prev) => ({ ...prev, [s.domain]: true }));
    updateResults({ [s.domain]: { domain: s.domain, ok: false, error: '测试中…' } } as any);
    try {
      const r = await fetch('/api/sites/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: s.domain })
      });
      const result: TestResult = await r.json();
      updateResults({ [s.domain]: result });
      if (result.ok) {
        toast.success(`${s.name} 测试通过 — ${result.results} 条结果 (${result.elapsed}ms)`);
      } else {
        toast.error(`${s.name} 测试失败：${result.error}`);
      }
    } catch (e) {
      updateResults({
        [s.domain]: { domain: s.domain, ok: false, error: (e as Error).message }
      });
      toast.error(`${s.name} 请求失败`);
    } finally {
      setTesting((prev) => ({ ...prev, [s.domain]: false }));
    }
  }, [updateResults]);

  const testAll = useCallback(async () => {
    for (const s of items) {
      await testSite(s);
    }
  }, [items, testSite]);

  // ---- Form handlers ----
  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(s: Site) {
    setEditing(s);
    setForm({
      name: s.name,
      domain: s.domain,
      url: s.url,
      pri: s.pri,
      publicSite: s.publicSite,
      username: (s as any).username || '',
      password: (s as any).password || '',
      cookie: s.cookie || '',
      ua: s.ua || '',
      passkey: s.passkey || '',
      proxy: s.proxy,
      note: s.note || ''
    });
    setDialogOpen(true);
  }

  async function autoLogin() {
    if (!form.url.trim() || !form.username.trim() || !form.password.trim()) {
      toast.error('请先填写网址、账号、密码');
      return;
    }
    setLoggingIn(true);
    try {
      // Derive domain/name from URL if not already filled
      let name = form.name.trim();
      let domain = form.domain.trim();
      const urlRaw = form.url.trim();
      if (!domain || !name) {
        try {
          const u = new URL(urlRaw.includes('://') ? urlRaw : `https://${urlRaw}`);
          domain = domain || u.hostname.replace(/^www\./, '');
          name = name || (domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1));
        } catch {
          /* ignore */
        }
      }
      if (!domain) {
        toast.error('无法从网址推导域名，请手动填写');
        setLoggingIn(false);
        return;
      }

      // First save the site (create if new) so login API can find it
      if (!editing) {
        const sr = await fetch('/api/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name || domain,
            domain,
            url: urlRaw.includes('://') ? urlRaw : `https://${urlRaw}`,
            pri: form.pri,
            publicSite: false,
            username: form.username.trim(),
            password: form.password.trim()
          })
        });
        if (!sr.ok) {
          const d = await sr.json();
          toast.error(d.error || '保存站点失败');
          setLoggingIn(false);
          return;
        }
        const created = await sr.json();
        setEditing(created);
        // Sync derived fields back into the form so doSubmitLogin can use them
        setForm((prev) => ({
          ...prev,
          name: created.name,
          domain: created.domain,
          url: created.url
        }));
      }

      // Phase 1: fetch login page to check for captcha
      const captchaRes = await fetch('/api/sites/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'captcha',
          domain
        })
      });
      const captchaData = await captchaRes.json();

      if (captchaData.error) {
        toast.error(`获取登录页失败：${captchaData.error}`);
        return;
      }

      if (captchaData.step === 'captcha' && captchaData.image) {
        // Captcha required - show dialog and wait for user input
        setCaptchaImage(captchaData.image);
        setCaptchaSessionId(captchaData.sessionId);
        setCaptchaText('');
        setCaptchaOpen(true);
        // autoLogin continues in submitCaptcha()
        return;
      }

      // No captcha - proceed directly to submit
      if (captchaData.step === 'nocaptcha' && captchaData.sessionId) {
        await doSubmitLogin(captchaData.sessionId, undefined);
      }
    } catch (e) {
      toast.error(`登录请求失败：${(e as Error).message}`);
    } finally {
      setLoggingIn(false);
    }
  }

  /** Phase 2: submit login with optional captcha text. */
  async function doSubmitLogin(sessionId: string, captcha?: string) {
    setCaptchaSubmitting(true);
    try {
      const r = await fetch('/api/sites/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'submit',
          sessionId,
          domain: form.domain.trim(),
          username: form.username.trim(),
          password: form.password.trim(),
          captcha,
          update: true
        })
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(
          d.passkey
            ? '登录成功，已获取 Cookie + Passkey'
            : '登录成功，已获取 Cookie（未获取到 Passkey 不影响下载）'
        );
        setForm((prev) => ({
          ...prev,
          cookie: d.cookie || prev.cookie,
          passkey: d.passkey || prev.passkey
        }));
        setCaptchaOpen(false);
      } else {
        toast.error(`登录失败：${d.error}`);
        // If captcha error, keep dialog open for retry with new image
        if (/验证码/.test(d.error)) {
          // Re-fetch captcha image for retry
          await refreshCaptcha();
        } else {
          setCaptchaOpen(false);
        }
      }
    } catch (e) {
      toast.error(`登录请求失败：${(e as Error).message}`);
      setCaptchaOpen(false);
    } finally {
      setCaptchaSubmitting(false);
    }
  }

  /** Re-fetch a fresh captcha image (for retry). */
  async function refreshCaptcha() {
    try {
      const captchaRes = await fetch('/api/sites/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'captcha',
          domain: form.domain.trim()
        })
      });
      const captchaData = await captchaRes.json();
      if (captchaData.step === 'captcha' && captchaData.image) {
        setCaptchaImage(captchaData.image);
        setCaptchaSessionId(captchaData.sessionId);
        setCaptchaText('');
      }
    } catch {
      /* ignore */
    }
  }

  async function saveSite() {
    if (!form.url.trim()) {
      toast.error('请填写站点网址');
      return;
    }
    // Derive domain/name from URL if empty
    let name = form.name.trim();
    let domain = form.domain.trim();
    const urlRaw = form.url.trim();
    const fullUrl = urlRaw.includes('://') ? urlRaw : `https://${urlRaw}`;
    if (!domain || !name) {
      try {
        const u = new URL(fullUrl);
        domain = domain || u.hostname.replace(/^www\./, '');
        name = name || (domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1));
      } catch {
        /* ignore */
      }
    }
    if (!domain) {
      toast.error('无法从网址推导域名，请手动填写域名');
      return;
    }
    setSaving(true);
    const r = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        name: name || domain,
        domain,
        url: fullUrl,
        username: form.username.trim() || null,
        password: form.password.trim() || null,
        cookie: form.cookie.trim() || null,
        ua: form.ua.trim() || null,
        passkey: form.passkey.trim() || null,
        note: form.note.trim() || null
      })
    });
    if (r.ok) {
      toast.success(editing ? '站点已更新' : '站点已添加');
      setDialogOpen(false);
      reload();
    } else {
      const d = await r.json();
      toast.error(d.error || '保存失败');
    }
    setSaving(false);
  }

  async function deleteSite(s: Site) {
    if (!confirm(`确定要删除站点 "${s.name}" (${s.domain}) 吗？`)) return;
    const r = await fetch(`/api/sites/${s.id}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success(`已删除：${s.name}`);
      reload();
    } else {
      toast.error('删除失败');
    }
  }

  // ---- Split ----
  const publicSites = items.filter((s) => s.publicSite);
  const privateSites = items.filter((s) => !s.publicSite);

  function renderTable(sites: Site[], isPublic: boolean) {
    return (
      <Table>
        <THead>
          <Tr>
            <Th>优先级</Th>
            <Th>名称</Th>
            <Th>域名</Th>
            <Th>状态</Th>
            <Th>连通性</Th>
            <Th>说明</Th>
            <Th></Th>
          </Tr>
        </THead>
        <TBody>
          {sites.map((s) => {
            const tr = testResults[s.domain];
            return (
              <Tr key={s.id}>
                <Td>{s.pri}</Td>
                <Td>{s.name}</Td>
                <Td className="font-mono text-xs">{s.domain}</Td>
                <Td>
                  <Badge variant={s.isActive ? 'success' : 'outline'}>
                    {s.isActive ? '启用' : '禁用'}
                  </Badge>
                </Td>
                <Td>
                  {tr ? (
                    <Badge variant={tr.ok ? 'success' : 'destructive'}>
                      {tr.ok ? `${tr.results}条 ${tr.elapsed}ms` : '失败'}
                    </Badge>
                  ) : testing[s.domain] ? (
                    <span className="text-xs text-muted-foreground">测试中…</span>
                  ) : null}
                </Td>
                <Td className="max-w-[200px] truncate text-xs text-muted-foreground" title={s.note || undefined}>
                  {s.note || '—'}
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggle(s)}>
                      {s.isActive ? '禁用' : '启用'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testSite(s)}
                      disabled={testing[s.domain]}
                    >
                      <Play className="mr-1 h-3 w-3" />
                      测试
                    </Button>
                    {!isPublic && (
                      <Button size="sm" variant="outline" onClick={() => deleteSite(s)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                      编辑
                    </Button>
                  </div>
                </Td>
              </Tr>
            );
          })}
          {sites.length === 0 && (
            <Tr>
              <Td colSpan={7} className="text-center text-muted-foreground">
                {isPublic ? '暂无公开站点' : '暂无私有站点，点击"添加站点"创建'}
              </Td>
            </Tr>
          )}
        </TBody>
      </Table>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">站点管理</h1>
          <p className="text-sm text-muted-foreground">管理公开站点与私有站点，测试连通性</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={testAll} disabled={Object.values(testing).some(Boolean)}>
            <RefreshCcw className="mr-1 h-3 w-3" />
            全部测试
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1 h-3 w-3" />
            添加站点
          </Button>
        </div>
      </div>

      {/* 公开站点 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            公开站点 ({publicSites.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renderTable(publicSites, true)}
        </CardContent>
      </Card>

      {/* 私有站点 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            私有站点 ({privateSites.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renderTable(privateSites, false)}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? '编辑站点' : '添加站点'}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">站点网址 *</label>
            <Input
              value={form.url}
              onChange={(e) => {
                const url = e.target.value.trim();
                // Auto-derive domain and name from URL
                let domain = '';
                let name = '';
                try {
                  const u = new URL(url.includes('://') ? url : `https://${url}`);
                  domain = u.hostname.replace(/^www\./, '');
                  name = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
                } catch {
                  // Not a valid URL yet - derive from raw text
                  const stripped = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
                  if (stripped) {
                    domain = stripped.split('/')[0].split('?')[0];
                    name = domain.split('.')[0]
                      ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
                      : '';
                  }
                }
                setForm((prev) => ({
                  ...prev,
                  url,
                  domain: domain || prev.domain,
                  name: prev.name || name
                }));
              }}
              placeholder="例如：https://example.com 或 example.com"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              填写网址后自动推导域名和名称，可在下方修改
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">名称</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="自动填充，可修改"
              />
            </div>
            <div>
              <label className="text-sm font-medium">域名</label>
              <Input
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="自动填充，可修改"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">优先级</label>
              <Input
                type="number"
                value={form.pri}
                onChange={(e) => setForm({ ...form, pri: Number(e.target.value) || 1 })}
              />
            </div>
            <div className="flex items-end gap-4 pb-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.publicSite}
                  onCheckedChange={(v) => setForm({ ...form, publicSite: v })}
                />
                公开站点
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.proxy}
                  onCheckedChange={(v) => setForm({ ...form, proxy: v })}
                />
                使用代理
              </label>
            </div>
          </div>
          {/* Private site: auto-login section */}
          {!form.publicSite && (
            <>
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">自动登录（NexusPHP）</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={autoLogin}
                    disabled={loggingIn}
                  >
                    <LogIn className="mr-1 h-3 w-3" />
                    {loggingIn ? '登录中…' : '登录获取'}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground">账号</label>
                    <Input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="站点用户名"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">密码</label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="站点密码"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  填写账号密码后点"登录获取"，系统自动抓取 Cookie 和 Passkey。
                </p>
                {(form.cookie || form.passkey) && (
                  <div className="flex gap-2 text-xs">
                    <Badge variant={form.cookie ? 'success' : 'outline'}>
                      Cookie: {form.cookie ? '已获取' : '未获取'}
                    </Badge>
                    <Badge variant={form.passkey ? 'success' : 'outline'}>
                      Passkey: {form.passkey ? '已获取' : '未获取'}
                    </Badge>
                  </div>
                )}
              </div>
              {/* Advanced: manually edit Cookie/Passkey */}
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  高级：手动填写 Cookie / Passkey
                </summary>
                <div className="mt-2 space-y-3">
                  <div>
                    <label className="text-sm font-medium">Cookie</label>
                    <Input
                      value={form.cookie}
                      onChange={(e) => setForm({ ...form, cookie: e.target.value })}
                      placeholder="可选，自动登录会自动填充"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Passkey</label>
                    <Input
                      value={form.passkey}
                      onChange={(e) => setForm({ ...form, passkey: e.target.value })}
                      placeholder="可选，自动登录会自动填充"
                    />
                  </div>
                </div>
              </details>
            </>
          )}
          <div>
            <label className="text-sm font-medium">User-Agent</label>
            <Input
              value={form.ua}
              onChange={(e) => setForm({ ...form, ua: e.target.value })}
              placeholder="可选，留空使用默认 UA"
            />
          </div>
          <div>
            <label className="text-sm font-medium">说明</label>
            <Input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="备注信息"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={saveSite} disabled={saving}>
              {saving ? '保存中…' : editing ? '更新' : '添加'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Captcha Dialog */}
      <Dialog
        open={captchaOpen}
        onClose={() => setCaptchaOpen(false)}
        title="请输入验证码"
        className="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={captchaImage}
              alt="验证码"
              className="rounded border border-border"
              style={{ maxHeight: 80 }}
            />
            <Button size="sm" variant="ghost" onClick={refreshCaptcha} disabled={captchaSubmitting}>
              <RefreshCcw className="mr-1 h-3 w-3" />
              换一张
            </Button>
          </div>
          <div>
            <label className="text-sm font-medium">验证码</label>
            <Input
              value={captchaText}
              onChange={(e) => setCaptchaText(e.target.value)}
              placeholder="输入图片中的字符"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && captchaText.trim()) {
                  doSubmitLogin(captchaSessionId, captchaText.trim());
                }
              }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCaptchaOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => doSubmitLogin(captchaSessionId, captchaText.trim())}
              disabled={captchaSubmitting || !captchaText.trim()}
            >
              {captchaSubmitting ? '登录中…' : '确认登录'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}