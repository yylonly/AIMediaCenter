import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { aggregatedSearch } from '@/core/indexer/registry';
import type { MediaType } from '@/core/meta/types';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = url.searchParams.get('keyword')?.trim();
  const mtype = (url.searchParams.get('type') as MediaType | null) || undefined;
  const page = Number(url.searchParams.get('page') || 1);
  const sitesParam = url.searchParams.get('sites');
  const sites = sitesParam ? sitesParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  if (!keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 });

  const results = await aggregatedSearch({ keyword, mtype, page, sites });
  return NextResponse.json({ total: results.length, items: results });
}
