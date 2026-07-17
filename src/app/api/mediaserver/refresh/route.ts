import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { refreshJellyfin, syncJellyfin } from '@/core/mediaserver/jellyfin';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'refresh';
  if (action === 'sync') {
    const res = await syncJellyfin();
    return NextResponse.json(res);
  }
  const ok = await refreshJellyfin();
  return NextResponse.json({ ok });
}
