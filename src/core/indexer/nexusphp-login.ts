// NexusPHP auto-login with captcha + challenge-response support.
// Flow:
//   1. GET /login.php -> capture session cookie + imagehash + captcha image URL
//      Also detect if the site uses Challenge-Response Authentication (CRA)
//      by looking for a "response" hidden field + crypto-js script.
//   2. (CRA only) POST /api/challenge {username} -> get {secret, challenge}
//      Compute: response = HMAC-SHA256(challenge, SHA256(secret + SHA256(password)))
//   3. POST /takelogin.php with credentials + captcha + (CRA response or plain password)
//   4. GET various pages -> extract passkey
import * as cheerio from 'cheerio';
import { createHash, createHmac } from 'crypto';
import { fetchWithProxy } from '@/lib/proxy';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hmacSha256(key: string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

/** Extract cookie pairs from a Set-Cookie header list. */
function parseSetCookie(res: Response): string {
  const setCookies = (res.headers as any).getSetCookie?.() as string[] | undefined;
  if (setCookies && setCookies.length > 0) {
    return setCookies.map((c) => c.split(';')[0]).join('; ');
  }
  // Fallback: manual parse of raw set-cookie header
  const raw = res.headers.get('set-cookie');
  if (raw) {
    return raw
      .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
      .map((c) => c.split(';')[0])
      .join('; ');
  }
  return '';
}

/** Resolve a possibly-relative URL against the site base. */
function resolveUrl(href: string, base: string): string {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return base.replace(/\/$/, '') + href;
  return base.replace(/\/$/, '') + '/' + href;
}

export interface LoginPageInfo {
  /** Session cookie from the GET /login.php response. */
  cookie: string;
  /** Hidden imagehash field value (only present if captcha is required). */
  imagehash?: string;
  /** Captcha image URL (only present if captcha is required). */
  captchaImageUrl?: string;
  /** True if the site uses Challenge-Response Authentication (crypto-js). */
  useCRA?: boolean;
}

/**
 * Phase 1: Fetch the login page to obtain session cookie + captcha info.
 * Returns imagehash and captchaImageUrl if the site requires a captcha.
 */
export async function fetchLoginPage(
  siteUrl: string,
  ua?: string | null
): Promise<LoginPageInfo> {
  const base = siteUrl.replace(/\/$/, '');
  const headers = {
    'User-Agent': ua || DEFAULT_UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };

  const res = await fetchWithProxy('ptSites', `${base}/login.php`, { headers, redirect: 'manual' });
  if (!res.ok && res.status !== 302) {
    throw new Error(`GET /login.php 返回 HTTP ${res.status}`);
  }

  // Some NexusPHP sites (e.g. 52pt.site) don't set a session cookie on GET login.php.
  // They manage session server-side and only return auth cookies (c_secure_*) after
  // successful login. The captcha imagehash is embedded in the HTML itself, so we
  // don't actually need the session cookie for the two-phase captcha flow.
  const cookie = parseSetCookie(res);

  const html = await res.text();
  const $ = cheerio.load(html);

  // Extract imagehash hidden field (NexusPHP standard)
  let imagehash: string | undefined;
  const hashInput = $('input[name="imagehash"]');
  if (hashInput.length) {
    imagehash = hashInput.attr('value') || undefined;
  }

  // Extract captcha image URL - NexusPHP uses img with src containing "image.php"
  let captchaImageUrl: string | undefined;
  if (imagehash) {
    const captchaImg = $('img[src*="image.php"]').first();
    if (captchaImg.length) {
      captchaImageUrl = resolveUrl(captchaImg.attr('src') || '', base);
    }
    // Fallback: construct the standard URL if not found in HTML
    if (!captchaImageUrl) {
      captchaImageUrl = `${base}/image.php?action=login`;
    }
  }

  // Detect Challenge-Response Authentication (CRA):
  // The login page includes a hidden "response" field + a crypto-js script
  // that encrypts the password client-side before submission.
  const useCRA =
    $('input[name="response"]').length > 0 &&
    ($('script[src*="crypto-js"]').length > 0 || /crypto-js|challengeResponse/i.test(html));

  return { cookie, imagehash, captchaImageUrl, useCRA };
}

/**
 * Fetch the captcha image as a base64 data URI (using the same session cookie).
 */
export async function fetchCaptchaImage(
  imageUrl: string,
  cookie: string,
  ua?: string | null
): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': ua || DEFAULT_UA,
    Referer: imageUrl.replace(/image\.php.*$/, 'login.php')
  };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetchWithProxy('ptSites', imageUrl, { headers });
  if (!res.ok) {
    throw new Error(`获取验证码图片失败: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/png';
  return `data:${contentType};base64,${buf.toString('base64')}`;
}

export interface SubmitLoginOpts {
  username: string;
  password: string;
  /** User-entered captcha text (if captcha was required). */
  imagestring?: string;
  /** Hidden imagehash from the login page (if captcha was required). */
  imagehash?: string;
  /** Whether the site uses Challenge-Response Authentication. */
  useCRA?: boolean;
}

export interface SubmitLoginResult {
  ok: boolean;
  /** The final session cookie after successful login. */
  cookie?: string;
  error?: string;
}

/**
 * Challenge-Response Authentication handshake.
 * Calls POST /api/challenge {username} to obtain {secret, challenge},
 * then computes response = HMAC-SHA256(challenge, SHA256(secret + SHA256(password))).
 */
async function getCraResponse(
  base: string,
  cookie: string,
  username: string,
  password: string,
  ua: string
): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Content-Type': 'application/json'
  };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetchWithProxy('ptSites', `${base}/api/challenge`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username })
  });
  if (!res.ok) {
    throw new Error(`CRA challenge failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { ret: number; msg?: string; data?: { secret: string; challenge: string } };
  if (data.ret !== 0 || !data.data) {
    throw new Error(`CRA challenge error: ${data.msg || 'unknown'}`);
  }
  const { secret, challenge } = data.data;
  // Replicate the browser-side crypto:
  //   clientHashedPassword = SHA256(password)
  //   serverSideHash = SHA256(secret + clientHashedPassword)
  //   response = HMAC-SHA256(challenge, serverSideHash)
  const clientHashedPassword = sha256(password);
  const serverSideHash = sha256(secret + clientHashedPassword);
  return hmacSha256(challenge, serverSideHash);
}

/**
 * Phase 2: Submit login credentials to /takelogin.php.
 * Uses the session cookie from fetchLoginPage().
 * Automatically handles Challenge-Response Authentication if useCRA is set.
 */
export async function submitLogin(
  siteUrl: string,
  cookie: string,
  opts: SubmitLoginOpts,
  ua?: string | null
): Promise<SubmitLoginResult> {
  const base = siteUrl.replace(/\/$/, '');
  const userAgent = ua || DEFAULT_UA;
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${base}/login.php`
  };
  if (cookie) headers['Cookie'] = cookie;

  const params = new URLSearchParams();

  if (opts.useCRA) {
    // Challenge-Response: compute encrypted response, don't send plaintext password
    try {
      const response = await getCraResponse(base, cookie, opts.username, opts.password, userAgent);
      params.set('username', opts.username);
      params.set('response', response);
    } catch (e) {
      return { ok: false, error: `CRA 握手失败: ${(e as Error).message}` };
    }
  } else {
    // Plain text password
    params.set('username', opts.username);
    params.set('password', opts.password);
  }

  if (opts.imagehash && opts.imagestring) {
    params.set('imagehash', opts.imagehash);
    params.set('imagestring', opts.imagestring);
  }

  const res = await fetchWithProxy('ptSites', `${base}/takelogin.php`, {
    method: 'POST',
    headers,
    body: params.toString(),
    redirect: 'manual'
  });

  // Merge new cookies from response into the existing session cookie
  const newCookies = parseSetCookie(res);
  const finalCookie = mergeCookies(cookie, newCookies);

  const location = res.headers.get('location') || '';

  // Success: NexusPHP redirects to index.php (302) on successful login
  if (res.status === 302 || res.status === 303) {
    if (/login|takelogin/i.test(location)) {
      return { ok: false, error: '用户名或密码错误（重定向回登录页）' };
    }
    if (!finalCookie) {
      return { ok: false, error: '登录后未获取到 Cookie' };
    }
    return { ok: true, cookie: finalCookie };
  }

  // 200 response - check for error messages in HTML
  if (res.status === 200) {
    const html = await res.text();
    const $ = cheerio.load(html);
    const bodyText = $('body').text() || html;
    if (/登录失败|用户名或密码错|login fail/i.test(bodyText)) {
      return { ok: false, error: '用户名或密码错误' };
    }
    if (/验证码|captcha|imagecode|验证码错误/i.test(bodyText)) {
      return { ok: false, error: '验证码错误' };
    }
    // If we got cookies and no obvious error, treat as success
    if (finalCookie) {
      return { ok: true, cookie: finalCookie };
    }
    return { ok: false, error: '登录失败（未获取到 Cookie）' };
  }

  return { ok: false, error: `登录请求返回 HTTP ${res.status}` };
}

/** Merge two cookie strings, preferring the newer values on key conflict. */
function mergeCookies(oldCookie: string, newCookies: string): string {
  if (!newCookies) return oldCookie;
  const map = new Map<string, string>();
  for (const c of oldCookie.split('; ')) {
    const idx = c.indexOf('=');
    if (idx > 0) map.set(c.slice(0, idx), c.slice(idx + 1));
  }
  for (const c of newCookies.split('; ')) {
    const idx = c.indexOf('=');
    if (idx > 0) map.set(c.slice(0, idx), c.slice(idx + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Phase 3: Extract passkey from various NexusPHP pages.
 * Tries multiple known locations since different NexusPHP forks store it differently.
 */
export async function extractPasskey(
  siteUrl: string,
  cookie: string,
  ua?: string | null
): Promise<string | undefined> {
  const base = siteUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'User-Agent': ua || DEFAULT_UA
  };
  if (cookie) headers['Cookie'] = cookie;

  // Pages that may contain the passkey, ordered by likelihood.
  // NexusPHP forks vary: some use getrss.php, some usercp.php, some my.php,
  // and some only expose it in the user profile (userdetails.php?id=X).
  const pages = ['getrss.php', 'usercp.php', 'my.php', 'index.php'];

  for (const page of pages) {
    try {
      const res = await fetchWithProxy('ptSites', `${base}/${page}`, { headers, redirect: 'manual' });
      if (!res.ok && res.status !== 302) continue;
      const text = await res.text();
      // Match passkey=XXXX in URLs, or "PassKey" labels followed by the value
      const m =
        text.match(/passkey=([a-zA-Z0-9]{16,})/) ||
        text.match(/PassKey["':\s>]+([a-zA-Z0-9]{16,})/i) ||
        text.match(/密钥[^a-zA-Z0-9]*([a-zA-Z0-9]{32})/);
      if (m) return m[1];
    } catch {
      /* try next page */
    }
  }

  // Last resort: fetch the user profile link from index.php, then load it.
  // The profile page typically shows "密钥 (PassKey)" with the value.
  try {
    const indexRes = await fetchWithProxy('ptSites', `${base}/index.php`, { headers, redirect: 'manual' });
    if (indexRes.ok || indexRes.status === 302) {
      const indexText = await indexRes.text();
      // Find userdetails.php?id=X link
      const profileLink = indexText.match(/userdetails\.php\?id=\d+/);
      if (profileLink) {
        const profRes = await fetchWithProxy('ptSites', `${base}/${profileLink[0]}`, { headers });
        if (profRes.ok) {
          const profText = await profRes.text();
          const m =
            profText.match(/passkey=([a-zA-Z0-9]{16,})/) ||
            profText.match(/PassKey["':\s>]+([a-zA-Z0-9]{16,})/i) ||
            profText.match(/密钥[^a-zA-Z0-9]*([a-zA-Z0-9]{32})/);
          if (m) return m[1];
        }
      }
    }
  } catch {
    /* best-effort */
  }

  return undefined;
}

// ---- Convenience: stateless one-shot login (no captcha) ----

export interface LoginResult {
  ok: boolean;
  cookie?: string;
  passkey?: string;
  error?: string;
  /** Present if the site requires a captcha - caller should use the two-phase flow. */
  captchaRequired?: boolean;
}

/**
 * Quick-path login without captcha. If the site requires a captcha,
 * returns { ok: false, captchaRequired: true } so the caller can fall
 * back to the two-phase flow.
 */
export async function nexusphpLogin(
  siteUrl: string,
  username: string,
  password: string,
  ua?: string | null
): Promise<LoginResult> {
  try {
    const page = await fetchLoginPage(siteUrl, ua);
    if (page.imagehash) {
      // Captcha required - caller must use two-phase flow
      return { ok: false, captchaRequired: true };
    }
    const login = await submitLogin(siteUrl, page.cookie, { username, password, useCRA: page.useCRA }, ua);
    if (!login.ok || !login.cookie) {
      return { ok: false, error: login.error };
    }
    const passkey = await extractPasskey(siteUrl, login.cookie, ua);
    return { ok: true, cookie: login.cookie, passkey };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
