import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/api';
import { organize } from '@/core/chain/transfer';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (!body.source) return jsonError('source required');
  const res = await organize({
    source: body.source,
    downloadHash: body.downloadHash,
    tmdbid: body.tmdbid,
    mtype: body.mtype,
    mode: body.mode,
    scrape: body.scrape
  });
  return NextResponse.json(res);
}
