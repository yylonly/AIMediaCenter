import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { searchSubscriptions } from '@/core/chain/subscribe';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const total = await searchSubscriptions(body.id ? Number(body.id) : undefined);
  return NextResponse.json({ ok: true, picked: total });
}
