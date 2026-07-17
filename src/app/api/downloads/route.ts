import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import {
  listTorrents,
  pauseTorrent,
  resumeTorrent,
  removeTorrent
} from '@/core/downloader/qbittorrent';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const status = (url.searchParams.get('status') as 'completed' | 'downloading' | 'all' | null) || 'all';
  const list = await listTorrents({ status });
  return NextResponse.json({ items: list });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    hash?: string;
    hashes?: string[];
    deleteFiles?: boolean;
  };
  const { action, hash, hashes, deleteFiles } = body;

  if (action === 'batch-remove' && hashes?.length) {
    let removed = 0;
    for (const h of hashes) {
      const ok = await removeTorrent(h, !!deleteFiles);
      if (ok) removed++;
    }
    return NextResponse.json({ ok: removed > 0, removed });
  }

  if (!action || !hash) return NextResponse.json({ error: 'action/hash required' }, { status: 400 });
  let ok = false;
  if (action === 'pause') ok = await pauseTorrent(hash);
  else if (action === 'resume') ok = await resumeTorrent(hash);
  else if (action === 'remove') ok = await removeTorrent(hash, !!deleteFiles);
  else return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  return NextResponse.json({ ok });
}
