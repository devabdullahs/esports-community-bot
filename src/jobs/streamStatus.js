import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { EmbedBuilder } from 'discord.js';
import { channelUrl, getActiveChannelMeta, listDistinctActiveHandles } from '../db/streamChannels.js';
import { getStreamStatus, listLiveStreamStatuses, markStaleStatusesOffline, upsertStreamStatus } from '../db/streamChannelStatus.js';
import { getGuildsWithCostreamAnnounce, getSettings } from '../db/settings.js';
import { categoryToGameSlug, gameName } from '../lib/games.js';
import * as twitch from '../services/twitch.js';
import * as kick from '../services/kick.js';
import * as youtube from '../services/youtube.js';

// Poll every active channel's live status into stream_channel_status. Batched: one
// Get Streams call per 100 Twitch logins, one channels call per 50 Kick slugs.
// YouTube has no batch API (status comes from each channel's public /live page),
// so it refreshes on its own, slower cadence inside the same tick.

async function refreshPlatform(platform, handles, fetchLive, { absentMeansOffline = true } = {}) {
  const liveMap = await fetchLive(handles);
  let live = 0;
  for (const handle of handles) {
    const info = liveMap.get(handle);
    // Twitch's API returns LIVE channels only, so absence there means offline
    // (absentMeansOffline). YouTube's page probe omits a handle only when the
    // FETCH failed — keep its previous status instead of flapping a live embed.
    if (!info && !absentMeansOffline) continue;
    const isLive = Boolean(info?.isLive);
    if (isLive) live += 1;
    await upsertStreamStatus({ platform, handle, ...(info ?? {}), isLive });
  }
  return { live, checked: handles.length };
}

// YouTube's page probe is heavier than the Twitch/Kick APIs — skip most ticks so
// it effectively refreshes every streams.youtubePollSeconds.
let lastYoutubeRunAt = 0;

// --- Go-live announcements ---------------------------------------------------
// When a tracked channel transitions offline -> live, post once in the guild's
// configured announce channel (/set_costreams). Re-announce cooldown guards
// against status flaps; the DB-persisted previous status means a bot RESTART
// never re-announces channels that were already live.
const ANNOUNCE_COOLDOWN_MS = 30 * 60 * 1000;
const lastAnnouncedAt = new Map(); // `${platform}:${handle}` -> ms epoch

const PLATFORM_LABELS = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', soop: 'SOOP' };

async function announceGoLive(client, newlyLive, now = Date.now) {
  if (!client || !newlyLive.length) return 0;
  const guildIds = await getGuildsWithCostreamAnnounce();
  if (!guildIds.length) return 0;

  let sent = 0;
  for (const key of newlyLive) {
    const at = lastAnnouncedAt.get(key);
    if (at && now() - at < ANNOUNCE_COOLDOWN_MS) continue;
    const [platform, ...rest] = key.split(':');
    const handle = rest.join(':');
    const status = await getStreamStatus(platform, handle);
    if (!status?.isLive) continue;
    // Same relevance rule as the website: skip channels live in an off-topic
    // category; an UNKNOWN category (YouTube's probe) passes.
    const gameSlug = status.category ? categoryToGameSlug(status.category) : null;
    if (status.category && !gameSlug) continue;
    const meta = await getActiveChannelMeta(platform, handle);
    const watchUrl = channelUrl(platform, handle);

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`🔴 ${meta?.label || handle} is live on ${PLATFORM_LABELS[platform] ?? platform}!`)
      .setDescription(status.title ? status.title.slice(0, 200) : null)
      .setURL(watchUrl);
    if (gameSlug) embed.addFields({ name: 'Game', value: gameName(gameSlug), inline: true });
    if (status.viewerCount != null) {
      embed.addFields({ name: 'Viewers', value: status.viewerCount.toLocaleString('en'), inline: true });
    }
    embed.addFields({ name: 'Watch', value: watchUrl, inline: false });
    if (status.thumbnailUrl && /^https:\/\//.test(status.thumbnailUrl)) embed.setImage(status.thumbnailUrl);

    let delivered = false;
    for (const guildId of guildIds) {
      const settings = await getSettings(guildId);
      const channelId = settings.costream_announce_channel_id;
      if (!channelId) continue;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.()) continue;
      try {
        await channel.send({ embeds: [embed] });
        delivered = true;
        sent += 1;
      } catch (e) {
        logger.warn(`[stream-status] go-live announce failed in ${guildId}: ${e.message}`);
      }
    }
    if (delivered) lastAnnouncedAt.set(key, now());
  }
  return sent;
}

// `twitchSvc`/`kickSvc`/`youtubeSvc` are injectable for tests (no network).
export async function refreshStreamStatus({
  twitchSvc = twitch,
  kickSvc = kick,
  youtubeSvc = youtube,
  now = Date.now,
  client = announceClient,
} = {}) {
  // Snapshot who was live BEFORE this refresh so offline -> live transitions
  // can be announced afterwards.
  const liveBefore = new Set((await listLiveStreamStatuses()).map((s) => `${s.platform}:${s.handle}`));
  const handles = await listDistinctActiveHandles();
  const byPlatform = { twitch: [], kick: [], youtube: [] };
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

  if (youtubeSvc.isConfigured() && byPlatform.youtube.length && now() - lastYoutubeRunAt >= config.streams.youtubePollSeconds * 1000) {
    lastYoutubeRunAt = now();
    try {
      const r = await refreshPlatform('youtube', byPlatform.youtube, (hs) => youtubeSvc.getLiveChannels(hs), {
        absentMeansOffline: false,
      });
      summary.push(`youtube ${r.live}/${r.checked}`);
    } catch (e) {
      logger.warn(`[stream-status] youtube refresh failed: ${e.message}`);
    }
  }

  // Channels removed from the registry stop being polled — force them offline.
  await markStaleStatusesOffline(Math.max(600, config.streams.pollSeconds * 5));

  const liveAfter = (await listLiveStreamStatuses()).map((s) => `${s.platform}:${s.handle}`);
  const newlyLive = liveAfter.filter((key) => !liveBefore.has(key));
  try {
    await announceGoLive(client, newlyLive, now);
  } catch (e) {
    logger.warn(`[stream-status] go-live announce pass failed: ${e.message}`);
  }

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
let announceClient = null;

export function startStreamStatusJob(client = null) {
  announceClient = client;
  if (!twitch.isConfigured() && !kick.isConfigured() && !youtube.isConfigured()) {
    logger.info('[stream-status] no stream platform enabled — live co-stream status disabled.');
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
