// Poll qBittorrent for completed torrents and run the transfer chain.
import { prisma } from '@/lib/prisma';
import { listTorrents } from '@/core/downloader/qbittorrent';
import { organize } from '@/core/chain/transfer';

const inflight = new Set<string>();

/** Load host download path from DB (or a sensible default). */
async function loadHostDownloadDir(): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'paths' } });
  const p = row ? (JSON.parse(row.value) as { download?: string }) : {};
  return p.download || '/Users/yylonly/qb-test/downloads';
}

export async function transferPoll(): Promise<void> {
  const torrents = await listTorrents({ status: 'completed' });
  const hostDownloadDir = await loadHostDownloadDir();

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
      // qBittorrent returns container paths (e.g. /downloads/tv/file.mkv).
      // Translate to the host path so organize() can stat the real files.
      const containerPath = t.contentPath || `${t.savePath.replace(/\/$/, '')}/${t.name}`;
      const hostPath = containerPath.replace(/^\/downloads/, hostDownloadDir);
      console.log(`[transferPoll] organising ${hostPath} (container: ${containerPath})`);
      await organize({
        source: hostPath,
        downloadHash: hash,
        tmdbid: history.tmdbid ?? undefined,
        mtype: (history.type as 'movie' | 'tv') || undefined
      });
    } catch (e) {
      console.warn('[transferPoll] failed', hash, (e as Error).message);
    } finally {
      inflight.delete(hash);
    }
  }
}
