import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { resetTmdbClient } from '@/core/tmdb/client';
import { resetProxyCache } from '@/lib/proxy';
import { loadPaths } from '@/core/chain/transfer';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.systemConfig.findMany();
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  // Inject a read-only snapshot of the default movie/tv dirs for consumers
  // (mediaserver move-to-library) that don't need to understand the rules
  // array. loadPaths() already migrates legacy configs.
  try {
    const paths = await loadPaths();
    const root = paths.deploymentMode === 'container' ? paths.containerMediaRoot : paths.hostMediaRoot;
    const join = (r: string, s: string) =>
      !s ? r : s.startsWith('/') ? s : `${r.replace(/\/$/, '')}/${s}`;
    out.pathsActive = {
      movie: join(root, paths.defaultMovieSubdir),
      tv: join(root, paths.defaultTvSubdir)
    };
  } catch {
    /* paths not configured yet - skip */
  }
  // The roots currently in effect (from the container's env / volume mounts).
  // The settings UI diffs these against the desired (DB) roots to know when a
  // container rebuild is needed. Empty when not running under the managed
  // docker deployment.
  out.activeRoots = {
    hostMediaRoot: process.env.HOST_MEDIA_ROOT || '',
    hostDownloadRoot: process.env.HOST_DOWNLOAD_ROOT || '',
    containerMediaRoot: process.env.CONTAINER_MEDIA_ROOT || '',
    containerDownloadRoot: process.env.CONTAINER_DOWNLOAD_ROOT || ''
  };
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  for (const [key, value] of Object.entries(body)) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) }
    });
  }
  // Invalidate memoised clients (proxy config change affects all of them)
  resetProxyCache();
  resetTmdbClient();
  return NextResponse.json({ ok: true });
}
