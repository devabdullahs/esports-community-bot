import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { listTrackedMatchLogos } from '../db/matches.js';
import { loadLogoBytes as defaultLoadLogoBytes } from '../lib/logoSource.js';

let task = null;
let running = false;

// Pre-download tracked-match crests into the shared on-disk cache. The web logo
// proxy serves only crests already in that cache — it deliberately refuses to
// fetch upstream on public page views (rate-limit / SSRF guard) — so without
// this the tournament directory shows initials for any crest the bot has not
// happened to render on a match card yet. Downloads go through logoSource's
// serial, 10s-paced, back-off-protected queue, so a run is naturally throttled;
// we additionally cap fresh downloads per run so a single run stays bounded and
// load spreads across the day. Already-cached crests are near-instant.
export async function warmTrackedMatchLogos({
  load = defaultLoadLogoBytes,
  listLogos = listTrackedMatchLogos,
  maxDownloads = config.logoWarmup.maxDownloadsPerRun,
} = {}) {
  if (running) {
    logger.debug('[logo-warmup] already running - skipping overlapping run.');
    return { skipped: 'already-running', warmed: 0, downloaded: 0, cached: 0, failed: 0 };
  }

  running = true;
  const summary = { skipped: null, total: 0, warmed: 0, downloaded: 0, cached: 0, failed: 0 };
  try {
    const urls = await listLogos();
    summary.total = urls.length;
    for (const url of urls) {
      if (summary.downloaded >= maxDownloads) {
        logger.debug(`[logo-warmup] hit per-run download cap (${maxDownloads}); resuming next run.`);
        break;
      }
      let result = null;
      try {
        result = await load(url, 'bot', { download: true });
      } catch (e) {
        // logoSource throws "logo downloads backing off after a rate limit" while
        // a backoff is active; treat it as a miss and keep going (those calls
        // return fast, so the remaining list drains without hammering upstream).
        logger.debug(`[logo-warmup] warm failed (${url}): ${e.message}`);
      }
      if (result) {
        summary.warmed += 1;
        if (result.cached) summary.cached += 1;
        else summary.downloaded += 1;
      } else {
        summary.failed += 1;
      }
    }

    logger.info(
      `[logo-warmup] warmed ${summary.warmed}/${summary.total} crest(s) (${summary.downloaded} downloaded, ${summary.cached} cached, ${summary.failed} missed).`,
    );
    return summary;
  } finally {
    running = false;
  }
}

export function startLogoWarmup() {
  if (!config.logoWarmup.enabled) {
    logger.info('[logo-warmup] disabled (set LOGO_WARMUP_ENABLED=true to enable).');
    return;
  }
  if (!cron.validate(config.logoWarmup.cron)) {
    logger.warn(`[logo-warmup] invalid cron "${config.logoWarmup.cron}" - warmup disabled.`);
    return;
  }

  const runSafe = () => warmTrackedMatchLogos().catch((e) => logger.warn(`[logo-warmup] ${e.message}`));
  task = cron.schedule(config.logoWarmup.cron, runSafe, {
    timezone: config.logoWarmup.timezone,
  });
  logger.info(`[logo-warmup] scheduled "${config.logoWarmup.cron}" (${config.logoWarmup.timezone}).`);
}

export function stopLogoWarmup() {
  if (task) {
    task.stop();
    task = null;
  }
}
