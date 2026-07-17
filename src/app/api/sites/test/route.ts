import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { getIndexer } from '@/core/indexer/registry';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { domain, keyword } = await req.json().catch(() => ({}));
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 });
  const indexer = await getIndexer(domain);
  if (!indexer) return NextResponse.json({ error: `unknown site: ${domain}` }, { status: 404 });
  const t0 = performance.now();
  try {
    const results = await indexer.search({ keyword: keyword || 'test', page: 1 });
    const elapsed = Math.round(performance.now() - t0);
    return NextResponse.json({
      ok: true,
      domain,
      name: indexer.name,
      results: results.length,
      elapsed,
      sample: results.slice(0, 3).map((r) => ({ title: r.title, seeders: r.seeders }))
    });
  } catch (e) {
    const elapsed = Math.round(performance.now() - t0);
    return NextResponse.json({
      ok: false,
      domain,
      name: indexer.name,
      error: (e as Error).message,
      elapsed
    });
  }
}
