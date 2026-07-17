import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, type AuthPayload } from '@/core/auth/jwt';

export async function requireAuth(req: NextRequest): Promise<
  | { ok: true; user: AuthPayload }
  | { ok: false; response: NextResponse }
> {
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const cookie = req.cookies.get('access_token')?.value;
  const token = bearer || cookie;
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  const payload = await verifyAccessToken(token);
  if (!payload) {
    return { ok: false, response: NextResponse.json({ error: 'invalid token' }, { status: 401 }) };
  }
  return { ok: true, user: payload };
}

export function jsonError(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}
