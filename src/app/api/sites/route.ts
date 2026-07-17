import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { resetNexusphpCache } from '@/core/indexer/registry';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const items = await prisma.site.findMany({ orderBy: { pri: 'asc' } });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (!body.name || !body.domain || !body.url) {
    return NextResponse.json({ error: 'name/domain/url required' }, { status: 400 });
  }
  const site = await prisma.site.upsert({
    where: { domain: body.domain },
    update: body,
    create: body
  });
  // Invalidate NexusPHP cache so new config is picked up immediately
  if (!site.publicSite) resetNexusphpCache();
  return NextResponse.json(site);
}
