// Poll qBittorrent for completed torrents and run the transfer chain.
import { prisma } from '@/lib/prisma';
import { listTorrents } from '@/core/downloader/qbittorrent';
import { organize, loadPaths, loadRuleById, resolveDownloadDirs } from '@/core/chain/transfer';

const inflight = new Set<string>();

export async function transferPoll(): Promise<void> {
  const torrents = await listTorrents({ status: 'completed' });
  const pathsCfg = await loadPaths();

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
      // Resolve the path rule that was active when this download was
      // submitted (recorded on DownloadHistory as pathProfileId, repurposed
      // to store the rule id). Using the historical rule means editing rules
      // later doesn't break organising older downloads. Falls back to the
      // current config when no rule id is recorded.
      const rule = await loadRuleById(history.pathProfileId);
      // qb-side download dir (qb's own host view) and the app-container view
      // of the same dir, both resolved from the common roots + rule subdir.
      const { qbDir, appDir } = resolveDownloadDirs(rule, pathsCfg);
      const qbPath = qbDir.replace(/\/$/, '');
      const appPath = appDir.replace(/\/$/, '');

      // qBittorrent reports paths in its own view (qbPath); translate to the
      // app-container view (appPath) so organize() can stat the real files.
      const containerPath = t.contentPath || `${t.savePath.replace(/\/$/, '')}/${t.name}`;
      const hostPath = qbPath && qbPath !== appPath
        ? containerPath.replace(qbPath, appPath)
        : containerPath;
      const ruleName = rule?.name || (pathsCfg.rules.length ? '(规则已删)' : '(默认)');
      console.log(`[transferPoll] organising ${hostPath} (qb: ${containerPath}) [rule: ${ruleName}]`);
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
