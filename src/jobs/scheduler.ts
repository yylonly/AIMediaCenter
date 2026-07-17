import cron from 'node-cron';
import { searchSubscriptions } from '@/core/chain/subscribe';
import { transferPoll } from './transferPoll';
import { syncJellyfin } from '@/core/mediaserver/jellyfin';

let started = false;

/** Idempotent scheduler bootstrap. Called from `instrumentation.ts` on server boot. */
export function startScheduler(): void {
  if (started) return;
  started = true;

  const cSearch = process.env.CRON_SUBSCRIBE_SEARCH || '0 */8 * * *';
  const cPoll = process.env.CRON_TRANSFER_POLL || '* * * * *';
  const cSync = process.env.CRON_MEDIASERVER_SYNC || '0 3 * * *';

  cron.schedule(cSearch, () => {
    console.log('[cron] subscribe:search');
    searchSubscriptions().catch((e) => console.warn('[cron] subscribe:search failed', e));
  });

  cron.schedule(cPoll, () => {
    transferPoll().catch((e) => console.warn('[cron] transferPoll failed', e));
  });

  cron.schedule(cSync, () => {
    console.log('[cron] mediaserver:sync');
    syncJellyfin().catch((e) => console.warn('[cron] jellyfin sync failed', e));
  });

  console.log('[scheduler] started');
}
