import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { resetTmdbClient } from '@/core/tmdb/client';
import { resetNexusphpCache } from '@/core/indexer/registry';

// Backup format version. Bump if the shape changes; the POST handler
// validates this so older backups fail loudly rather than corrupting data.
const BACKUP_VERSION = 1;

interface BackupFile {
  version: number;
  exportedAt: string;
  app: string;
  data: {
    systemConfig?: any[];
    sites?: any[];
    subscribes?: any[];
    users?: any[];
  };
}

/**
 * GET /api/backup - export configuration as a downloadable JSON file.
 *
 * Snapshots the 4 config tables (SystemConfig, Site, Subscribe, User).
 * Runtime/history/cache tables are excluded - they're regeneratable.
 * Returns the JSON with a Content-Disposition header so browsers download it.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const [systemConfig, sites, subscribes, users] = await Promise.all([
    prisma.systemConfig.findMany(),
    prisma.site.findMany({ orderBy: { pri: 'asc' } }),
    prisma.subscribe.findMany({ orderBy: { id: 'asc' } }),
    prisma.user.findMany()
  ]);

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'AIMediaCenter',
    data: { systemConfig, sites, subscribes, users }
  };

  // Serialise once; used for both the body and the filename timestamp.
  const json = JSON.stringify(backup, null, 2);
  const ts = backup.exportedAt.replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHmm
  const filename = `aimediacenter-backup-${ts}.json`;

  return new NextResponse(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}

/**
 * POST /api/backup - restore (merge) a backup into the database.
 *
 * Merge semantics: each row is upserted on its natural unique key
 * (SystemConfig.key, Site.domain, User.name, Subscribe.id). Existing rows
 * with the same key are overwritten; rows not present in the backup are
 * left untouched. After restore, TMDB + NexusPHP caches are invalidated so
 * the new config takes effect immediately.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as BackupFile | null;
  if (!body) return jsonError('invalid JSON body');
  if (body.version !== BACKUP_VERSION) {
    return jsonError(
      `unsupported backup version: ${body.version} (expected ${BACKUP_VERSION})`,
      400
    );
  }
  const data = body.data;
  if (!data || typeof data !== 'object') {
    return jsonError('missing data field', 400);
  }

  const stats = { systemConfig: 0, sites: 0, subscribes: 0, users: 0 };

  // Use a transaction so a failure mid-restore rolls everything back.
  await prisma.$transaction(async (tx) => {
    // SystemConfig: upsert on key. value stays as the raw JSON string.
    for (const row of data.systemConfig || []) {
      if (!row?.key) continue;
      await tx.systemConfig.upsert({
        where: { key: row.key },
        update: { value: row.value },
        create: { key: row.key, value: row.value, note: row.note ?? null }
      });
      stats.systemConfig++;
    }

    // Site: upsert on domain. Strip the immutable id so create doesn't clash.
    for (const row of data.sites || []) {
      if (!row?.domain) continue;
      const { id, ...rest } = row;
      await tx.site.upsert({
        where: { domain: row.domain },
        update: rest,
        create: rest
      });
      stats.sites++;
    }

    // Subscribe: no natural unique key, so upsert on id. On conflict we keep
    // the existing row (skip) to preserve runtime state (downloaded episodes,
    // lack counters) unless the backup explicitly differs. Using update would
    // overwrite those - safer to skip existing ids.
    for (const row of data.subscribes || []) {
      if (row?.id == null) continue;
      const existing = await tx.subscribe.findUnique({ where: { id: row.id } });
      if (existing) {
        // Merge: update config fields but preserve runtime state.
        const { id, lackEpisode, note, currentPriority, lastUpdate, ...cfg } = row;
        await tx.subscribe.update({ where: { id: row.id }, data: cfg });
      } else {
        const { id: _id, ...create } = row;
        await tx.subscribe.create({ data: create });
      }
      stats.subscribes++;
    }

    // User: upsert on name. Includes hashedPassword + otpSecret so login
    // state is fully restored.
    for (const row of data.users || []) {
      if (!row?.name) continue;
      const { id, ...rest } = row;
      await tx.user.upsert({
        where: { name: row.name },
        update: rest,
        create: rest
      });
      stats.users++;
    }
  });

  // Invalidate memoised clients so restored config takes effect immediately.
  resetTmdbClient();
  resetNexusphpCache();

  return NextResponse.json({ ok: true, stats });
}
