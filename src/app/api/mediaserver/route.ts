import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import {
  listMediaItems,
  deleteMediaItem,
  deleteEpisode,
  getJellyfinStatus,
  refreshJellyfin,
  refreshItemMetadata,
  moveMediaItem,
  syncJellyfin,
  fetchEpisodes
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

  // ---- Batch operations ----
  if (action === 'batch-delete') {
    const ids: string[] = Array.isArray(body.itemIds) ? body.itemIds : [];
    if (ids.length === 0) return NextResponse.json({ error: 'itemIds required' }, { status: 400 });
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const r = await deleteMediaItem(id);
      if (r.ok) ok++;
      else errors.push(`${id}: ${r.error || 'unknown'}`);
    }
    return NextResponse.json({ ok: true, deleted: ok, total: ids.length, errors });
  }

  if (action === 'batch-deleteEpisodes') {
    const ids: string[] = Array.isArray(body.itemIds) ? body.itemIds : [];
    if (ids.length === 0) return NextResponse.json({ error: 'itemIds required' }, { status: 400 });
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const r = await deleteEpisode(id);
      if (r.ok) ok++;
      else errors.push(`${id}: ${r.error || 'unknown'}`);
    }
    return NextResponse.json({ ok: true, deleted: ok, total: ids.length, errors });
  }

  if (action === 'batch-refresh') {
    const ids: string[] = Array.isArray(body.itemIds) ? body.itemIds : [];
    if (ids.length === 0) return NextResponse.json({ error: 'itemIds required' }, { status: 400 });
    const recursive = body.recursive === true;
    const replaceAll = body.replaceAll === true;
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const r = await refreshItemMetadata(id, { recursive, replaceAll });
      if (r.ok) ok++;
      else errors.push(`${id}: ${r.error || 'unknown'}`);
    }
    return NextResponse.json({ ok: true, refreshed: ok, total: ids.length, errors });
  }

  if (action === 'batch-move') {
    const ids: string[] = Array.isArray(body.itemIds) ? body.itemIds : [];
    const destDir: string | undefined = typeof body.destDir === 'string' ? body.destDir : undefined;
    if (ids.length === 0) return NextResponse.json({ error: 'itemIds required' }, { status: 400 });
    if (!destDir) return NextResponse.json({ error: 'destDir required' }, { status: 400 });
    // Fetch current path + type for each item from DB cache
    const rows = await prisma.mediaServerItem.findMany({
      where: { server: 'jellyfin', itemId: { in: ids } }
    });
    let ok = 0;
    const errors: string[] = [];
    for (const row of rows) {
      if (!row.path) {
        errors.push(`${row.title}: no path recorded`);
        continue;
      }
      const r = await moveMediaItem(row.itemId, row.path, destDir, row.itemType === 'Series');
      if (r.ok) ok++;
      else errors.push(`${row.title}: ${r.error || 'unknown'}`);
    }
    const missing = ids.length - rows.length;
    if (missing > 0) errors.push(`${missing} item(s) not found in cache (sync first)`);
    return NextResponse.json({ ok: true, moved: ok, total: ids.length, errors });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}