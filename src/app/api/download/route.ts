import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/api';
import { submitDownload } from '@/core/chain/download';
import type { TorrentInfo } from '@/core/indexer/base';
import type { TmdbBrief } from '@/core/tmdb/client';

interface DownloadReq {
  torrent: TorrentInfo;
  media?: TmdbBrief;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as DownloadReq | null;
  if (!body?.torrent?.enclosure) return jsonError('torrent.enclosure required');
  const res = await submitDownload({
    torrent: body.torrent,
    media: body.media,
    username: auth.user.username
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true, hash: res.hash, historyId: res.historyId });
}
