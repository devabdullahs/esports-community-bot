import { logger } from '../lib/logger.js';
import { getMatchesForGuild, markStaleActiveFinished } from '../db/matches.js';
import { normalizeGameSlug, sameGame } from '../lib/games.js';
import {
  deleteMatchCardMessage,
  getGameMatchCards,
  getMatchCardMessages,
  setMatchCardMessage,
} from '../db/settings.js';
import { buildAllGamesStatusPayload, buildIdleMatchCardPayload, buildMatchCardPayload } from '../lib/matchMessage.js';

const ALL_GAMES = 'all';
const IDLE_MATCH_ID = 0;
// A match still flagged active this long after its start is treated as ended.
// Liquipedia can leave old rows in upcoming/live widgets without final scores.
const MAX_ACTIVE_SECONDS = 4 * 3600;

function byLiveOrder(a, b) {
  return (a.scheduled_at ?? Number.MAX_SAFE_INTEGER) - (b.scheduled_at ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;
}

function matchesForBoard(matches, game, dedicatedGames = new Set()) {
  const scoped =
    game === ALL_GAMES
      ? matches.filter((m) => !dedicatedGames.has(normalizeGameSlug(m.game)))
      : matches.filter((m) => sameGame(m.game, game));
  return scoped.filter((m) => m.status === 'running').sort(byLiveOrder).slice(0, 5);
}

function allMatchesForBoard(matches, game, dedicatedGames = new Set()) {
  return game === ALL_GAMES
    ? matches.filter((m) => !dedicatedGames.has(normalizeGameSlug(m.game)))
    : matches.filter((m) => sameGame(m.game, game));
}

async function fetchMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  return { channel, message };
}

async function deleteStoredMessage(client, row, guildId, game) {
  const found = await fetchMessage(client, row.channel_id, row.message_id);
  await found?.message?.delete().catch(() => {});
  await deleteMatchCardMessage(guildId, game, row.match_id);
}

async function upsertLiveCard(client, channel, board, match, scoped, existing) {
  const payload = await buildMatchCardPayload(match, {
    matches: scoped,
    showNextGameTag: board.game === ALL_GAMES,
  });
  if (existing) {
    if (existing.channel_id === board.channel_id) {
      const message = await channel.messages.fetch(existing.message_id).catch(() => null);
      if (message) {
        await message.edit({ ...payload, attachments: [] });
        return existing.message_id;
      }
    } else {
      await deleteStoredMessage(client, existing, board.guild_id, board.game);
    }
  }

  const sent = await channel.send(payload);
  logger.info(`[match-card] posted ${board.game} card ${sent.id} for match ${match.id} in guild ${board.guild_id}`);
  return sent.id;
}

async function upsertIdleCard(channel, board, matches, existing) {
  const payload = await buildIdleMatchCardPayload(board.game, matches);
  if (existing && existing.channel_id === board.channel_id) {
    const message = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (message) {
      await message.edit({ ...payload, attachments: [] });
      return existing.message_id;
    }
  }

  const sent = await channel.send(payload);
  logger.info(`[match-card] posted ${board.game} idle card ${sent.id} in guild ${board.guild_id}`);
  return sent.id;
}

async function upsertAllGamesStatusCard(channel, board, matches, existing) {
  const payload = await buildAllGamesStatusPayload(matches);
  if (existing && existing.channel_id === board.channel_id) {
    const message = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (message) {
      await message.edit({ ...payload, attachments: [] });
      return existing.message_id;
    }
  }

  const sent = await channel.send(payload);
  logger.info(`[match-card] posted all-games status card ${sent.id} in guild ${board.guild_id}`);
  return sent.id;
}

// Serialize updateMatchCards per guild. The async (Postgres) DB layer yields at
// every await, so two overlapping refreshes would each read "no card stored yet"
// and post duplicate match cards. Queue calls per guild so each run sees the prior
// run's writes and edits the existing card instead of re-posting.
const guildQueues = new Map();

export function updateMatchCards(client, guildId) {
  const prev = guildQueues.get(guildId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => updateMatchCardsImpl(client, guildId));
  guildQueues.set(guildId, run);
  run.catch(() => {}).finally(() => {
    if (guildQueues.get(guildId) === run) guildQueues.delete(guildId);
  });
  return run;
}

async function updateMatchCardsImpl(client, guildId) {
  const boards = await getGameMatchCards(guildId);
  if (!boards.length) return;

  // Clear matches stuck active long past their start so they drop off live/upcoming cards.
  await markStaleActiveFinished(MAX_ACTIVE_SECONDS);
  const matches = await getMatchesForGuild(guildId);
  const dedicatedGames = new Set(boards.filter((b) => b.game !== ALL_GAMES).map((b) => normalizeGameSlug(b.game)));
  for (const board of boards) {
    const channel = await client.channels.fetch(board.channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) continue;

    const scoped = allMatchesForBoard(matches, board.game, dedicatedGames);
    const live = matchesForBoard(matches, board.game, dedicatedGames);
    const liveIds = new Set(live.map((m) => m.id));
    const stored = await getMatchCardMessages(guildId, board.game);
    const byMatchId = new Map(stored.map((row) => [row.match_id, row]));

    if (board.game === ALL_GAMES) {
      for (const row of stored) {
        if (row.match_id !== IDLE_MATCH_ID) await deleteStoredMessage(client, row, guildId, board.game);
      }
      const existing = byMatchId.get(IDLE_MATCH_ID);
      if (existing && existing.channel_id !== board.channel_id) {
        await deleteStoredMessage(client, existing, guildId, board.game);
      }
      const messageId = await upsertAllGamesStatusCard(channel, { ...board, guild_id: guildId }, matches, existing);
      await setMatchCardMessage(guildId, board.game, IDLE_MATCH_ID, board.channel_id, messageId);
      continue;
    }

    if (!live.length) {
      for (const row of stored) {
        if (row.match_id !== IDLE_MATCH_ID) await deleteStoredMessage(client, row, guildId, board.game);
      }
      const existing = byMatchId.get(IDLE_MATCH_ID);
      if (existing && existing.channel_id !== board.channel_id) {
        await deleteStoredMessage(client, existing, guildId, board.game);
      }
      const messageId = await upsertIdleCard(channel, { ...board, guild_id: guildId }, scoped, existing);
      await setMatchCardMessage(guildId, board.game, IDLE_MATCH_ID, board.channel_id, messageId);
      continue;
    }

    for (const row of stored) {
      if (!liveIds.has(row.match_id)) {
        await deleteStoredMessage(client, row, guildId, board.game);
      }
    }

    for (const match of live) {
      const messageId = await upsertLiveCard(
        client,
        channel,
        { ...board, guild_id: guildId },
        match,
        scoped,
        byMatchId.get(match.id),
      );
      await setMatchCardMessage(guildId, board.game, match.id, board.channel_id, messageId);
    }
  }
}

export { ALL_GAMES };
