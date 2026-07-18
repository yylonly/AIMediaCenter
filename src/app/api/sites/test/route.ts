import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { getIndexer, searchSite } from '@/core/indexer/registry';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { domain, keyword } = await req.json().catch(() => ({}));
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 });
  const indexer = await getIndexer(domain);
  if (!indexer) return NextResponse.json({ error: `unknown site: ${domain}` }, { status: 404 });
  // Mirror aggregatedSearch: honour each site's per-site proxy flag so the
  // test exercises the same network path real searches use. Without this a
  // site marked proxy=true but with the global publicSites scope off would
  // appear to fail (direct connection to a blocked host) when searches work.
  const site = await prisma.site.findUnique({ where: { domain } });
  const t0 = performance.now();
  try {
    const results = await searchSite(indexer, { keyword: keyword || 'test', page: 1 }, { useProxy: site?.proxy ?? undefined });
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
