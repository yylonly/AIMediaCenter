import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { addSubscribe } from '@/core/chain/subscribe';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const items = await prisma.subscribe.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (!body.tmdbid || !body.type) return jsonError('tmdbid/type required');
  try {
    const s = await addSubscribe({
      tmdbid: Number(body.tmdbid),
      type: body.type,
      season: body.season ? Number(body.season) : undefined,
      username: auth.user.username,
      include: body.include,
      exclude: body.exclude,
      resolution: body.resolution,
      quality: body.quality
    });
    return NextResponse.json(s);
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
