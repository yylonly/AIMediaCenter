// Poll qBittorrent for completed torrents and run the transfer chain.
import { prisma } from '@/lib/prisma';
import { listTorrents } from '@/core/downloader/qbittorrent';
import { organize, loadPaths } from '@/core/chain/transfer';

const inflight = new Set<string>();

/**
 * Load the qb<->app path mapping from DB. qBittorrent reports save paths in
 * its own filesystem view; organize() runs inside the app container and needs
 * the app-side path. When qb is a sibling docker container the two views
 * coincide (`/downloads`); when qb is a NAS host suite they differ (qb sees
 * `/volume1/qBittorent`, app sees `/downloads` via a volume mount).
 */
async function loadPathMap(): Promise<{ qb: string; app: string }> {
  const paths = await loadPaths();
  return {
    qb: (paths.qbSavePath || paths.download).replace(/\/$/, ''),
    app: paths.download.replace(/\/$/, '')
  };
}

export async function transferPoll(): Promise<void> {
  const torrents = await listTorrents({ status: 'completed' });
  const { qb: qbPath, app: appPath } = await loadPathMap();

  for (const t of torrents) {
    const hash = t.hash;
    if (!hash || inflight.has(hash)) continue;
    // Ensure it originated from us
    const history = await prisma.downloadHistory.findFirst({ where: { downloadHash: hash } });
    if (!history) continue;
    // Skip if already transferred
    const done = await prisma.transferHistory.findFirst({
      where: { downloadHash: hash, status: true }
    });
    if (done) continue;

    inflight.add(hash);
    try {
      // qBittorrent reports paths in its own view (qbPath); translate to the
      // app-container view (appPath) so organize() can stat the real files.
      const containerPath = t.contentPath || `${t.savePath.replace(/\/$/, '')}/${t.name}`;
      const hostPath = qbPath && qbPath !== appPath
        ? containerPath.replace(qbPath, appPath)
        : containerPath;
      console.log(`[transferPoll] organising ${hostPath} (qb: ${containerPath})`);
      const result = await organize({
        source: hostPath,
        downloadHash: hash,
        tmdbid: history.tmdbid ?? undefined,
        mtype: (history.type as 'movie' | 'tv') || undefined
      });
      if (!result.ok) {
        console.warn(`[transferPoll] failed ${hash}:`, result.errors.join('; '));
      } else {
        console.log(`[transferPoll] done ${hash}: ${result.transferred} file(s)`);
      }
    } catch (e) {
      console.warn('[transferPoll] failed', hash, (e as Error).message);
    } finally {
      inflight.delete(hash);
    }
  }
}
