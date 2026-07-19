// Poll qBittorrent for completed torrents and run the transfer chain.
import { prisma } from '@/lib/prisma';
import { listTorrents } from '@/core/downloader/qbittorrent';
import { organize, loadProfileById } from '@/core/chain/transfer';

const inflight = new Set<string>();

export async function transferPoll(): Promise<void> {
  const torrents = await listTorrents({ status: 'completed' });

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
      // Resolve the path profile that was active when this download was
      // submitted (recorded on DownloadHistory). Using the historical profile
      // rather than the current active one means switching profiles later
      // doesn't break organising older downloads that were saved under a
      // different qb save path / library mapping. Falls back to the active
      // profile for records submitted before pathProfileId existed.
      const profile = await loadProfileById(history.pathProfileId);
      const qbPath = (profile.qbSavePath || profile.download).replace(/\/$/, '');
      const appPath = profile.download.replace(/\/$/, '');

      // qBittorrent reports paths in its own view (qbPath); translate to the
      // app-container view (appPath) so organize() can stat the real files.
      const containerPath = t.contentPath || `${t.savePath.replace(/\/$/, '')}/${t.name}`;
      const hostPath = qbPath && qbPath !== appPath
        ? containerPath.replace(qbPath, appPath)
        : containerPath;
      console.log(`[transferPoll] organising ${hostPath} (qb: ${containerPath}) [profile: ${profile.name}]`);
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
