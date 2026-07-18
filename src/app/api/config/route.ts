import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { resetTmdbClient } from '@/core/tmdb/client';
import { resetProxyCache } from '@/lib/proxy';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.systemConfig.findMany();
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  for (const [key, value] of Object.entries(body)) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) }
    });
  }
  // Invalidate memoised clients (proxy config change affects all of them)
  resetProxyCache();
  resetTmdbClient();
  return NextResponse.json({ ok: true });
}
