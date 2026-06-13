import { ContainerBuilder, SeparatorSpacingSize, MessageFlags } from 'discord.js';
import { logger } from '../lib/logger.js';
import { getMatchesForGuild } from '../db/matches.js';
import {
  getSettings,
  setLeaderboardMessage,
  getGameLeaderboards,
  setGameLeaderboardMessage,
} from '../db/settings.js';
import { matchLine, LIQUIPEDIA_ATTRIBUTION } from '../lib/render.js';
import { gameName, sameGame } from '../lib/games.js';

const nowSec = () => Math.floor(Date.now() / 1000);
const MAX_UPCOMING = 10;

// Append the required Liquipedia attribution footer (CC-BY-SA).
function addAttribution(c) {
  c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
  c.addTextDisplayComponents((td) => td.setContent(`-# ${LIQUIPEDIA_ATTRIBUTION}`));
}

function byScheduledAt(a, b) {
  return (a.scheduled_at ?? Number.MAX_SAFE_INTEGER) - (b.scheduled_at ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;
}

function balancedUpcoming(matches, limit = MAX_UPCOMING) {
  const scheduled = matches.filter((m) => m.status === 'scheduled').sort(byScheduledAt);
  const selected = [];
  const seenGames = new Set();

  for (const match of scheduled) {
    const game = match.game || 'unknown';
    if (seenGames.has(game)) continue;
    selected.push(match);
    seenGames.add(game);
    if (selected.length >= limit) return selected.sort(byScheduledAt);
  }

  for (const match of scheduled) {
    if (selected.some((m) => m.id === match.id)) continue;
    selected.push(match);
    if (selected.length >= limit) break;
  }

  return selected.sort(byScheduledAt);
}

// Build the live leaderboard as a Components V2 Container. If `game` is set, only that game's
// matches are shown (a per-game board); otherwise it's the combined "all games" board.
export async function buildLeaderboardContainer(guildId, game = null) {
  let matches = await getMatchesForGuild(guildId);
  if (game) matches = matches.filter((m) => sameGame(m.game, game));

  const c = new ContainerBuilder().setAccentColor(0x5865f2);
  const title = game ? `🏆 ${gameName(game)} Tracker` : '🏆 Esports Tracker';
  c.addTextDisplayComponents((td) => td.setContent(`## ${title}\n-# Updated <t:${nowSec()}:R>`));

  if (!matches.length) {
    c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents((td) =>
      td.setContent('_No matches tracked yet._ An admin can add one with `/add_tournament`.'),
    );
    addAttribution(c);
    return c;
  }

  const live = matches.filter((m) => m.status === 'running').slice(0, 12);
  const upcoming = game ? matches.filter((m) => m.status === 'scheduled').slice(0, MAX_UPCOMING) : balancedUpcoming(matches);
  const recent = matches
    .filter((m) => m.status === 'finished')
    .slice(-6)
    .reverse();

  const section = (heading, arr) => {
    if (!arr.length) return;
    c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents((td) => td.setContent(`### ${heading}\n${arr.map(matchLine).join('\n')}`));
  };
  section('🔴 Live now', live);
  section('🗓️ Upcoming', upcoming);
  section('✅ Recent results', recent);
  addAttribution(c);
  return c;
}

// Create or edit a single board's message.
async function updateBoard(client, guildId, game, channelId, messageId, saveMessageId) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const payload = { components: [await buildLeaderboardContainer(guildId, game)], flags: MessageFlags.IsComponentsV2 };
  if (messageId) {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (msg) {
      await msg.edit(payload);
      return;
    }
  }
  const sent = await channel.send(payload);
  await saveMessageId(sent.id);
  logger.info(`[leaderboard] posted ${game || 'all'} board ${sent.id} in guild ${guildId}`);
}

// Update the combined board AND every per-game board for a guild (all at once).
export async function updateLeaderboard(client, guildId) {
  const s = await getSettings(guildId);
  await updateBoard(client, guildId, null, s.leaderboard_channel_id, s.leaderboard_message_id, async (id) => {
    await setLeaderboardMessage(guildId, id);
  });
  for (const b of await getGameLeaderboards(guildId)) {
    await updateBoard(client, guildId, b.game, b.channel_id, b.message_id, async (id) => {
      await setGameLeaderboardMessage(guildId, b.game, id);
    });
  }
}
