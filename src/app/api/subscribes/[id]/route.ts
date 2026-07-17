import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { previewSubscription, downloadSelected } from '@/core/chain/subscribe';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const s = await prisma.subscribe.update({ where: { id: Number(id) }, data: body });
  return NextResponse.json(s);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await prisma.subscribe.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { action, keys } = (await req.json().catch(() => ({}))) as {
    action?: string;
    keys?: string[];
  };

  if (action === 'preview') {
    const result = await previewSubscription(Number(id));
    return NextResponse.json(result);
  }

  if (action === 'download') {
    if (!keys?.length) return NextResponse.json({ ok: false, error: 'keys required' }, { status: 400 });
    const result = await downloadSelected(Number(id), keys);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
