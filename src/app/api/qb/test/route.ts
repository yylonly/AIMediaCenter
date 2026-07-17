import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { testQb } from '@/core/downloader/qbittorrent';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const res = await testQb();
  return NextResponse.json(res);
}
