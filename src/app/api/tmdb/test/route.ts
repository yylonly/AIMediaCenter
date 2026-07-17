import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { testTmdb } from '@/core/tmdb/client';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const res = await testTmdb();
  return NextResponse.json(res);
}
