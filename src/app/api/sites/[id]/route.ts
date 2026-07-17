import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { resetNexusphpCache } from '@/core/indexer/registry';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const site = await prisma.site.update({ where: { id: Number(id) }, data: body });
  if (!site.publicSite) resetNexusphpCache();
  return NextResponse.json(site);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await prisma.site.delete({ where: { id: Number(id) } });
  resetNexusphpCache();
  return NextResponse.json({ ok: true });
}
