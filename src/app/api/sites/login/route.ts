import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import {
  fetchLoginPage,
  fetchCaptchaImage,
  submitLogin,
  extractPasskey
} from '@/core/indexer/nexusphp-login';
import { resetNexusphpCache } from '@/core/indexer/registry';

// Two-phase login flow:
//   step: 'captcha' -> fetch login page, return captcha image (if required)
//   step: 'submit'   -> submit credentials with optional captcha text
//
// sessionId is a base64-encoded JSON blob carrying {cookie, imagehash} across
// the two phases, keeping the backend stateless.

interface SessionState {
  cookie: string;
  imagehash?: string;
  useCRA?: boolean;
  siteUrl: string;
}

function encodeSession(s: SessionState): string {
  return Buffer.from(JSON.stringify(s)).toString('base64');
}

function decodeSession(id: string): SessionState {
  return JSON.parse(Buffer.from(id, 'base64').toString('utf-8'));
}

async function findSite(id?: number, domain?: string) {
  if (id) return prisma.site.findUnique({ where: { id } });
  if (domain) return prisma.site.findUnique({ where: { domain } });
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const step = body.step || 'captcha';

  // ---- Phase 1: fetch login page + captcha ----
  if (step === 'captcha') {
    const { domain, siteId } = body;
    const site = await findSite(siteId, domain);
    if (!site) return NextResponse.json({ error: '站点不存在，请先添加' }, { status: 404 });

    try {
      const page = await fetchLoginPage(site.url, site.ua);
      if (!page.imagehash) {
        // No captcha needed - return immediately so frontend can skip to submit
        return NextResponse.json({
          step: 'nocaptcha',
          sessionId: encodeSession({
            cookie: page.cookie,
            useCRA: page.useCRA,
            siteUrl: site.url
          })
        });
      }
      // Fetch the captcha image using the same session cookie
      const image = await fetchCaptchaImage(page.captchaImageUrl!, page.cookie, site.ua);
      return NextResponse.json({
        step: 'captcha',
        sessionId: encodeSession({
          cookie: page.cookie,
          imagehash: page.imagehash,
          useCRA: page.useCRA,
          siteUrl: site.url
        }),
        image
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ---- Phase 2: submit login ----
  if (step === 'submit') {
    const { sessionId, username, password, captcha, domain, update } = body;
    if (!username || !password) {
      return NextResponse.json({ error: 'username and password required' }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required (call step=captcha first)' }, { status: 400 });
    }

    let session: SessionState;
    try {
      session = decodeSession(sessionId);
    } catch {
      return NextResponse.json({ error: '无效的 sessionId' }, { status: 400 });
    }

    const site = await findSite(undefined, domain);
    const ua = site?.ua || null;

    try {
      const result = await submitLogin(session.siteUrl, session.cookie, {
        username,
        password,
        imagehash: session.imagehash,
        imagestring: captcha,
        useCRA: session.useCRA
      }, ua);

      if (!result.ok || !result.cookie) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }

      // Extract passkey using the authenticated cookie
      const passkey = await extractPasskey(session.siteUrl, result.cookie, ua);

      // Persist back to DB if requested
      if (update && domain) {
        await prisma.site.update({
          where: { domain },
          data: {
            cookie: result.cookie,
            passkey: passkey || null,
            username,
            password
          }
        });
        resetNexusphpCache();
      }

      return NextResponse.json({
        ok: true,
        cookie: result.cookie,
        passkey
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `unknown step: ${step}` }, { status: 400 });
}
