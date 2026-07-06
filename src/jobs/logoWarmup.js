import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { listTrackedMatchLogos } from '../db/matches.js';
import { listStandingsLogos } from '../db/tournamentStandings.js';
import { listLiquipediaTeamLogos } from '../db/teams.js';
import { listLiquipediaPlayerLogos, listPriorityLiquipediaPlayerLogos } from '../db/players.js';
import { loadLogoBytes as defaultLoadLogoBytes } from '../lib/logoSource.js';

let task = null;
let bootTimer = null;
let running = false;

// Every Liquipedia-hosted image the site renders, warmed into the shared cache
// so the web proxy can serve them without ever hotlinking Liquipedia. EWC player
// portraits come first because profile pages cannot fetch them on-demand; match
// crests follow (time-sensitive), then standings and the remaining entity media.
// Order matters because the per-run cap counts fresh downloads
// only — cached URLs skip cheaply, so over successive runs the whole set warms.
async function listWarmableLogos() {
  const [priorityPlayers, matches, standings, teams, players] = await Promise.all([
    listPriorityLiquipediaPlayerLogos(),
    listTrackedMatchLogos(),
    listStandingsLogos(),
    listLiquipediaTeamLogos(),
    listLiquipediaPlayerLogos(),
  ]);
  const seen = new Set();
  const ordered = [];
  for (const url of [...priorityPlayers, ...matches, ...standings, ...teams, ...players]) {
    if (url && !seen.has(url)) {
      seen.add(url);
      ordered.push(url);
    }
  }
  return ordered;
}

// Pre-download every Liquipedia-hosted image the site renders (match crests,
// standings crests, team/player entity images) into the shared on-disk cache.
// The web logo proxy serves only images already in that cache — it deliberately
// refuses to fetch upstream on public page views (rate-limit / SSRF guard) — so
// without this the directory, standings tables and profile pages show initials
// for any Liquipedia image the bot has not happened to cache yet. Downloads go
// through logoSource's serial, 10s-paced, back-off-protected queue, so a run is
// naturally throttled; we additionally cap fresh downloads per run so a single
// run stays bounded and load spreads across the day. Already-cached images are
// near-instant and do not count against the cap.
export async function warmTrackedMatchLogos({
  load = defaultLoadLogoBytes,
  listLogos = listWarmableLogos,
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

  bootTimer = setTimeout(runSafe, config.logoWarmup.bootDelayMs);
  bootTimer.unref?.();
  logger.info(`[logo-warmup] first run in ${Math.round(config.logoWarmup.bootDelayMs / 1000)}s.`);
}

export function stopLogoWarmup() {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (task) {
    task.stop();
    task = null;
  }
}
