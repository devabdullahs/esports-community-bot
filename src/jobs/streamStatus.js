import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { EmbedBuilder } from 'discord.js';
import { channelUrl, getActiveChannelMeta, listDistinctActiveHandles } from '../db/streamChannels.js';
import { listLiveStreamStatuses, markStaleStatusesOffline, upsertStreamStatus } from '../db/streamChannelStatus.js';
import { getStreamCreatorAnnouncement, recordStreamCreatorAnnouncement } from '../db/streamAnnouncements.js';
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
const CROSS_PLATFORM_DEDUP_MS = 6 * 60 * 60 * 1000;
const lastAnnouncedAt = new Map(); // creator key -> ms epoch

const PLATFORM_LABELS = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', soop: 'SOOP' };
const PLATFORM_RANK = { twitch: 0, kick: 1, youtube: 2, soop: 3 };

async function liveCreatorGroups(statuses) {
  const groups = new Map();
  for (const status of statuses) {
    const meta = await getActiveChannelMeta(status.platform, status.handle);
    if (!meta) continue;
    const creatorKey = meta.creatorKey || `${status.platform}:${status.handle}`;
    const entries = groups.get(creatorKey) ?? [];
    entries.push({ status, meta });
    groups.set(creatorKey, entries);
  }
  return groups;
}

function selectAnnouncementEntry(entries) {
  return entries
    .map(({ status, meta }) => {
      const gameSlug = status.category ? categoryToGameSlug(status.category) : null;
      if (status.category && !gameSlug) return null;
      return { status, meta, gameSlug };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.meta.isDefault !== b.meta.isDefault) return a.meta.isDefault ? -1 : 1;
      if (a.meta.sortOrder !== b.meta.sortOrder) return a.meta.sortOrder - b.meta.sortOrder;
      return (PLATFORM_RANK[a.meta.platform] ?? 99) - (PLATFORM_RANK[b.meta.platform] ?? 99);
    })[0] ?? null;
}

async function announceGoLive(client, liveBefore, liveAfter, now = Date.now) {
  if (!client || !liveAfter.length) return 0;
  const guildIds = await getGuildsWithCostreamAnnounce();
  if (!guildIds.length) return 0;

  const beforeGroups = await liveCreatorGroups(liveBefore);
  const afterGroups = await liveCreatorGroups(liveAfter);
  let sent = 0;
  for (const [creatorKey, entries] of afterGroups) {
    if (beforeGroups.has(creatorKey)) continue;
    const candidate = selectAnnouncementEntry(entries);
    if (!candidate) continue;
    const nowMs = now();
    const at = lastAnnouncedAt.get(creatorKey);
    if (at && nowMs - at < ANNOUNCE_COOLDOWN_MS) continue;
    const { status, meta, gameSlug } = candidate;
    const { platform, handle } = status;
    const stored = await getStreamCreatorAnnouncement(creatorKey);
    const storedWindow =
      stored?.platform && stored.platform !== platform ? CROSS_PLATFORM_DEDUP_MS : ANNOUNCE_COOLDOWN_MS;
    if (stored?.announcedAt && nowMs - stored.announcedAt * 1000 < storedWindow) {
      lastAnnouncedAt.set(creatorKey, stored.announcedAt * 1000);
      continue;
    }
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
      const roleId = settings.costream_announce_role_id;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.()) continue;
      try {
        await channel.send({
          content: roleId ? `<@&${roleId}>` : undefined,
          embeds: [embed],
          allowedMentions: roleId ? { roles: [roleId], parse: [] } : { parse: [] },
        });
        delivered = true;
        sent += 1;
      } catch (e) {
        logger.warn(`[stream-status] go-live announce failed in ${guildId}: ${e.message}`);
      }
    }
    if (delivered) {
      const announcedAt = Math.floor(nowMs / 1000);
      lastAnnouncedAt.set(creatorKey, nowMs);
      await recordStreamCreatorAnnouncement({
        creatorKey,
        announcedAt,
        platform,
        handle,
        title: status.title || null,
        liveStartedAt: status.startedAt,
      });
    }
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
  const liveBefore = await listLiveStreamStatuses();
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

  const liveAfter = await listLiveStreamStatuses();
  try {
    await announceGoLive(client, liveBefore, liveAfter, now);
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

export function resetStreamStatusStateForTests() {
  lastAnnouncedAt.clear();
  lastYoutubeRunAt = 0;
  firstReported = false;
}
