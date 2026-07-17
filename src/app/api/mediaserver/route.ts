import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import {
  listMediaItems,
  deleteMediaItem,
  getJellyfinStatus,
  refreshJellyfin,
  syncJellyfin,
  fetchEpisodes,
  deleteEpisode
} from '@/core/mediaserver/jellyfin';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'list';

  if (action === 'status') {
    const status = await getJellyfinStatus();
    return NextResponse.json(status);
  }

  if (action === 'sync') {
    const result = await syncJellyfin();
    return NextResponse.json(result);
  }

  if (action === 'episodes') {
    const parentId = url.searchParams.get('parentId');
    if (!parentId) return NextResponse.json({ error: 'parentId required' }, { status: 400 });
    const episodes = await fetchEpisodes(parentId);
    return NextResponse.json({ episodes });
  }

  const type = url.searchParams.get('type') || undefined;
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 50;
  const data = await listMediaItems({ type, page, pageSize });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { action, itemId } = body;

  if (action === 'refresh') {
    const ok = await refreshJellyfin();
    return NextResponse.json({ ok });
  }

  if (action === 'delete' && itemId) {
    const result = await deleteMediaItem(itemId);
    return NextResponse.json(result);
  }

  if (action === 'deleteEpisode' && itemId) {
    const result = await deleteEpisode(itemId);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}