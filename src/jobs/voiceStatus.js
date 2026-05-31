import { logger } from '../lib/logger.js';
import { getMatchesForGuild } from '../db/matches.js';
import { getSettings } from '../db/settings.js';
import { gameTag, truncate } from '../lib/render.js';

// Discord rate-limits channel renames to ~2 per 10 minutes PER CHANNEL. We therefore
// never rename on a fixed poll tick — only when the computed name actually changes, and
// at most once per MIN_RENAME_GAP_MS. Renames requested during the cooldown are coalesced
// into a single deferred rename using the most recent desired name.
const MIN_RENAME_GAP_MS = 6 * 60 * 1000;
const VOICE_NAME_MAX = 100;

const state = new Map(); // channelId -> { at, name, timer, pending }

export function computeVoiceName(guildId) {
  const matches = getMatchesForGuild(guildId);

  const live = matches.find((m) => m.status === 'running');
  if (live) {
    const tag = gameTag(live.game);
    const lead = tag ? `${tag} - ` : '';
    const score = live.score_a != null && live.score_b != null ? ` ${live.score_a}-${live.score_b}` : '';
    return truncate(`🔴 LIVE: ${lead}${live.team_a} vs ${live.team_b}${score}`, VOICE_NAME_MAX);
  }

  const next = matches.find((m) => m.status === 'scheduled');
  if (next) {
    const tag = gameTag(next.game);
    const lead = tag ? `${tag} - ` : '';
    return truncate(`🗓️ Next: ${lead}${next.team_a} vs ${next.team_b}`, VOICE_NAME_MAX);
  }
  return '💤 No live matches';
}

export async function updateVoiceChannel(client, guildId) {
  const s = getSettings(guildId);
  if (!s.voice_channel_id) return;
  const channel = await client.channels.fetch(s.voice_channel_id).catch(() => null);
  if (!channel) return;
  applyRename(channel, computeVoiceName(guildId));
}

function applyRename(channel, desired) {
  let st = state.get(channel.id);
  if (!st) {
    st = { at: 0, name: null, timer: null, pending: null };
    state.set(channel.id, st);
  }
  if (desired === st.name) return; // nothing changed

  const since = Date.now() - st.at;
  if (since >= MIN_RENAME_GAP_MS && !st.timer) {
    doRename(channel, desired);
    return;
  }
  // In cooldown: remember the latest desired name and ensure a single deferred rename.
  st.pending = desired;
  if (!st.timer) {
    const wait = Math.max(0, MIN_RENAME_GAP_MS - since);
    st.timer = setTimeout(() => {
      st.timer = null;
      const next = st.pending;
      st.pending = null;
      if (next && next !== st.name) doRename(channel, next);
    }, wait);
    st.timer.unref?.();
    logger.debug(`[voice] rename for ${channel.id} deferred ${Math.round(wait / 1000)}s (cooldown)`);
  }
}

async function doRename(channel, name) {
  const st = state.get(channel.id) ?? {};
  try {
    await channel.setName(name);
    st.at = Date.now();
    st.name = name;
    state.set(channel.id, st);
    logger.info(`[voice] ${channel.id} → "${name}"`);
  } catch (e) {
    logger.warn(`[voice] rename failed (${channel.id}): ${e.message}`);
  }
}
