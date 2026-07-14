import cron from 'node-cron';
import { purgeWebAnalyticsEvents } from '../db/webAnalytics.js';
import { logger } from '../lib/logger.js';

export const WEB_ANALYTICS_RETENTION_DAYS = 90;
export const WEB_ANALYTICS_RETENTION_CRON = '15 4 * * *';
export const WEB_ANALYTICS_RETENTION_TIMEZONE = 'Asia/Riyadh';

let task = null;
let running = false;

export async function purgeWebAnalyticsRetention({
  nowSec = Math.floor(Date.now() / 1000),
  cutoff = nowSec - WEB_ANALYTICS_RETENTION_DAYS * 86400,
} = {}) {
  if (running) return { skipped: 'already-running' };
  running = true;
  try {
    return await purgeWebAnalyticsEvents(cutoff);
  } finally {
    running = false;
  }
}

export function startWebAnalyticsRetention() {
  if (task) return;
  const runSafe = () =>
    purgeWebAnalyticsRetention()
      .then((summary) => {
        if (!('skipped' in summary)) {
          logger.info(`[analytics-retention] purged ${summary.webEvents} traffic event(s) and ${summary.productEvents} product event(s).`);
        }
      })
      .catch((error) => logger.warn(`[analytics-retention] ${error.message}`));
  task = cron.schedule(WEB_ANALYTICS_RETENTION_CRON, runSafe, {
    timezone: WEB_ANALYTICS_RETENTION_TIMEZONE,
  });
  logger.info(`[analytics-retention] scheduled daily (${WEB_ANALYTICS_RETENTION_TIMEZONE}).`);
  void runSafe();
}

export function stopWebAnalyticsRetention() {
  if (task) {
    task.stop();
    task = null;
  }
}
