import {
  hasPendingScheduledNewsCacheRevalidation,
  markScheduledNewsCacheRevalidated,
} from '../db/ewcAdminAuditLog.js';
import { publishDueEwcNewsPosts } from '../db/ewcNewsPosts.js';
import { logger } from '../lib/logger.js';
import { revalidateDashboardNews } from '../services/dashboardInternalClient.js';

// The announcer owns the interval; this job only promotes due rows. A rejected
// promotion is deliberately surfaced to the next interval, leaving the row in
// scheduled state for a later retry.
export async function runScheduledNewsPublisher({
  promoteDue = publishDueEwcNewsPosts,
  revalidate = revalidateDashboardNews,
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
