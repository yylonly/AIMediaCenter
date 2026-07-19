import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { requireAuth } from '@/lib/api';
import { loadPaths } from '@/core/chain/transfer';

/**
 * Derive the config dir (where the SQLite db lives) from DATABASE_URL,
 * e.g. "file:/config/aimediacenter.db" -> "/config".
 */
function configDir(): string {
  const url = process.env.DATABASE_URL || '';
  if (url.startsWith('file:')) {
    const p = url.slice('file:'.length);
    if (p.startsWith('/')) return path.dirname(p);
  }
  return process.env.CONFIG_DIR || '/config';
}

/**
 * POST /api/system/restart
 *
 * The app cannot recreate its own container (and we deliberately don't mount
 * the docker socket). Instead it drops a restart-request file into the config
 * dir; the host-side nas-poll-update.sh picks it up on its next run, writes
 * the new path roots into the compose .env and runs `docker compose up -d`.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const cfg = await loadPaths();
  if (cfg.deploymentMode !== 'container') {
    return NextResponse.json({ error: '独立部署模式无需重建容器' }, { status: 400 });
  }

  // Flat single-line JSON so the host script can extract values with sed.
  const payload = JSON.stringify({
    HOST_MEDIA_ROOT: cfg.hostMediaRoot,
    HOST_DOWNLOAD_ROOT: cfg.hostDownloadRoot,
    CONTAINER_MEDIA_ROOT: cfg.containerMediaRoot,
    CONTAINER_DOWNLOAD_ROOT: cfg.containerDownloadRoot,
    requestedAt: new Date().toISOString()
  });

  try {
    const dir = path.join(configDir(), 'deploy');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'restart-request.json'), payload);
  } catch (e) {
    return NextResponse.json({ error: `写入重启请求失败: ${(e as Error).message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: '重建请求已提交，容器将在几分钟内以新路径重启' });
}
