// Poll qBittorrent for completed torrents and run the transfer chain.
import { prisma } from '@/lib/prisma';
import { listTorrents } from '@/core/downloader/qbittorrent';
import { organize, loadPaths, loadRuleById, resolveAppViewPath } from '@/core/chain/transfer';

const inflight = new Set<string>();

/** Whether a hash is currently being organised (manual or poll-triggered). */
export function isOrganizing(hash: string): boolean {
  return inflight.has(hash);
}

/** Mark/unmark a hash as organising (used by the manual-organize endpoint). */
export function setOrganizing(hash: string, on: boolean): void {
  if (on) inflight.add(hash);
  else inflight.delete(hash);
}

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
      // qBittorrent reports paths in its own (host) view; translate to the
      // app-container view so organize() can stat the real files.
      const containerPath = t.contentPath || `${t.savePath.replace(/\/$/, '')}/${t.name}`;
      const hostPath = resolveAppViewPath(t, rule, pathsCfg);
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
