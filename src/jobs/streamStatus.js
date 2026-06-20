import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { listDistinctActiveHandles } from '../db/streamChannels.js';
import { markStaleStatusesOffline, upsertStreamStatus } from '../db/streamChannelStatus.js';
import * as twitch from '../services/twitch.js';
import * as kick from '../services/kick.js';

// Poll every active channel's live status into stream_channel_status. Batched: one
// Get Streams call per 100 Twitch logins, one channels call per 50 Kick slugs.

async function refreshPlatform(platform, handles, fetchLive) {
  const liveMap = await fetchLive(handles);
  let live = 0;
  for (const handle of handles) {
    const info = liveMap.get(handle);
    const isLive = Boolean(info?.isLive);
    if (isLive) live += 1;
    await upsertStreamStatus({ platform, handle, ...(info ?? {}), isLive });
  }
  return { live, checked: handles.length };
}

// `twitchSvc`/`kickSvc` are injectable for tests (no network).
export async function refreshStreamStatus({ twitchSvc = twitch, kickSvc = kick } = {}) {
  const handles = await listDistinctActiveHandles();
  const byPlatform = { twitch: [], kick: [] };
  for (const h of handles) if (byPlatform[h.platform]) byPlatform[h.platform].push(h.handle);

  const summary = [];
  if (twitchSvc.isConfigured() && byPlatform.twitch.length) {
    try {
      const r = await refreshPlatform('twitch', byPlatform.twitch, (hs) => twitchSvc.getLiveStreams(hs));
      summary.push(`twitch ${r.live}/${r.checked}`);
    } catch (e) {
      logger.warn(`[stream-status] twitch refresh failed: ${e.message}`);
    }
  }
  if (kickSvc.isConfigured() && byPlatform.kick.length) {
    try {
      const r = await refreshPlatform('kick', byPlatform.kick, (hs) => kickSvc.getLiveChannels(hs));
      summary.push(`kick ${r.live}/${r.checked}`);
    } catch (e) {
      logger.warn(`[stream-status] kick refresh failed: ${e.message}`);
    }
  }

  // Channels removed from the registry stop being polled — force them offline.
  await markStaleStatusesOffline(Math.max(600, config.streams.pollSeconds * 5));
  if (summary.length) {
    // Log the first non-empty poll at info so the deploy confirms credentials work;
    // every cycle after that is debug to avoid 60s log spam.
    const line = `[stream-status] ${summary.join(', ')} (live/checked)`;
    if (firstReported) logger.debug(line);
    else {
      firstReported = true;
      logger.info(line);
    }
  }
  return summary;
}

let firstReported = false;
let timer = null;

export function startStreamStatusJob() {
  if (!twitch.isConfigured() && !kick.isConfigured()) {
    logger.info('[stream-status] no Twitch/Kick credentials set — live co-stream status disabled.');
    return;
  }
  const sec = config.streams.pollSeconds;
  const runSafe = () => refreshStreamStatus().catch((e) => logger.warn(`[stream-status] ${e.message}`));
  timer = setInterval(runSafe, sec * 1000);
  timer.unref?.();
  logger.info(`[stream-status] live co-stream status refresh every ${sec}s.`);
  runSafe(); // prime on boot
}

export function stopStreamStatusJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
