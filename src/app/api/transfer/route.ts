import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { listTorrents } from '@/core/downloader/qbittorrent';
import { organize, loadPaths, loadRuleById, resolveAppViewPath } from '@/core/chain/transfer';
import { isOrganizing, setOrganizing } from '@/jobs/transferPoll';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  // Manual organize from the downloads page: only a downloadHash is given;
  // resolve the app-view source path the same way transferPoll does.
  if (!body.source && body.downloadHash) {
    if (isOrganizing(body.downloadHash)) {
      return jsonError('该任务正在整理中，请稍候');
    }
    const history = await prisma.downloadHistory.findFirst({
      where: { downloadHash: body.downloadHash }
    });
    if (!history) return jsonError('找不到该下载的记录');
    const torrents = await listTorrents({ status: 'completed' });
    const t = torrents.find((x) => x.hash === body.downloadHash);
    if (!t) return jsonError('qBittorrent 中找不到已完成的该任务');
    const pathsCfg = await loadPaths();
    const rule = await loadRuleById(history.pathProfileId);
    body.source = resolveAppViewPath(t, rule, pathsCfg);
    body.tmdbid = body.tmdbid ?? history.tmdbid ?? undefined;
    body.mtype = body.mtype ?? (history.type as 'movie' | 'tv') ?? undefined;
  }

  if (!body.source) return jsonError('source required');

  const hash = body.downloadHash as string | undefined;
  if (hash) setOrganizing(hash, true);
  try {
    const res = await organize({
      source: body.source,
      downloadHash: body.downloadHash,
      tmdbid: body.tmdbid,
      mtype: body.mtype,
      mode: body.mode,
      scrape: body.scrape
    });
    return NextResponse.json(res);
  } finally {
    if (hash) setOrganizing(hash, false);
  }
}
