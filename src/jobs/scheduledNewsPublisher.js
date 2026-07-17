import { config } from '../config.js';
import {
  hasPendingScheduledNewsCacheRevalidation,
  markScheduledNewsCacheRevalidated,
} from '../db/ewcAdminAuditLog.js';
import { publishDueEwcNewsPosts } from '../db/ewcNewsPosts.js';
import { logger } from '../lib/logger.js';

async function revalidateNewsCache() {
  if (!config.dashboard.internalUrl || !config.dashboard.internalSecret) return;
  const response = await fetch(
    `${config.dashboard.internalUrl.replace(/\/$/, '')}/api/internal/news/revalidate`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'x-ewc-internal-secret': config.dashboard.internalSecret,
      },
    },
  );
  if (!response.ok) throw new Error(`dashboard cache revalidation failed (${response.status})`);
}

// The announcer owns the interval; this job only promotes due rows. A rejected
// promotion is deliberately surfaced to the next interval, leaving the row in
// scheduled state for a later retry.
export async function runScheduledNewsPublisher({
  promoteDue = publishDueEwcNewsPosts,
  revalidate = revalidateNewsCache,
  needsRevalidation = hasPendingScheduledNewsCacheRevalidation,
  markRevalidated = markScheduledNewsCacheRevalidated,
} = {}) {
  const posts = await promoteDue();
  const cacheRevalidationPending = posts.length > 0 || await needsRevalidation();

  if (cacheRevalidationPending) {
    try {
      await revalidate();
      await markRevalidated();
    } catch (error) {
      // The database transition already committed. Keep the retry marker set so
      // the next announcer tick invalidates the cache without republishing or
      // announcing the post a second time.
      logger.warn(`[news] scheduled publication cache revalidation failed: ${error.message}`);
    }
  }
  if (posts.length > 0) {
    logger.info(`[news] published ${posts.length} scheduled post${posts.length === 1 ? '' : 's'}`);
  }
  return posts;
}
