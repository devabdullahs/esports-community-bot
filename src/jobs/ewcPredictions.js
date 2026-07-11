import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import {
  listEwcWeeks,
  listOpenEwcWeeksForReminders,
  listEwcSeasonsForAutomation,
  listEwcWeeksForAutomation,
  listEwcWeeksToAnnounceOpen,
  markEwcWeekOpenAnnounced,
  claimEwcPredictionReminder,
  markEwcPredictionReminderSent,
  releaseEwcPredictionReminderClaim,
  getEwcSeason,
  listSeasonPredictions,
  listWeeklyPredictions,
  markEwcSeasonScored,
  markEwcWeekScored,
  markEwcWeekScoredWithResults,
  overallLeaderboard,
  seasonLeaderboard,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  setEwcSeasonStatus,
  setEwcWeekSnapshot,
  setEwcWeekResults,
  setEwcWeekStatus,
  weeklyLeaderboard,
} from '../db/ewcPredictions.js';
import { listEwcProfileLinks } from '../db/ewcProfileLinks.js';
import { recordEwcPredictionAutomationHealth } from '../db/ewcPredictionOperations.js';
import {
  getGuildsWithEwcPredictionLeaderboard,
  getSettings,
  setEwcPredictionsMentionsMessage,
  setEwcPredictionsLeaderboardMessage,
} from '../db/settings.js';
import { transaction } from '../db/client.js';
import { logger } from '../lib/logger.js';
import {
  effectiveEwcWeekStatus,
  dueEwcGamesForResults,
  ewcGameResultPending,
  mergeEwcGameResults,
  pendingEwcGameResults,
  scorePerGameWeeklyPrediction,
  scoreSeasonPrediction,
  scoreWeeklyPrediction,
} from '../lib/ewcPredictions.js';
import { resolveEwcGameEventUrl } from '../lib/ewcGameTeams.js';
import { renderEwcPredictionLeaderboardCard } from '../lib/ewcPredictionLeaderboardCard.js';
import { fetchEwcClubStandings, fetchEwcWeekGameResults } from '../services/liquipedia.js';

const nowSec = () => Math.floor(Date.now() / 1000);

function scoreAfter(round) {
  if (round.score_after) return round.score_after;
  if (!round.close_at) return null;
  return round.close_at + config.ewcPredictions.scoreDelayHours * 3600;
}

async function standingsFor(season) {
  const data = await fetchEwcClubStandings(season);
  if (!data.exists || !data.standings.length) return null;
  return data.standings;
}

function topPredictionLines(rows) {
  const rankedRows = rows.filter((prediction) => prediction.score != null).slice(0, 10);
  if (!rankedRows.length) return 'No scored predictions.';
  return rankedRows.map((row) => `**${row.rank}.** <@${row.user_id}> - \`${Number(row.score).toLocaleString()}\``).join('\n');
}

function leaderboardLines(rows, { championPickVisible = false } = {}) {
  if (!rows.length) return 'No scored predictions yet.';
  return rows
    .slice(0, 20)
    .map((row) => {
      const pick = championPickVisible ? ` - Champion pick: **${row.championPick || '-'}**` : '';
      return `**${row.rank}.** <@${row.user_id}> - \`${Number(row.score || 0).toLocaleString()}\`${pick}`;
    })
    .join('\n');
}

async function leaderboardRowsForImage(client, guildId, rows) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  return Promise.all(
    rows.map(async (row) => {
      let label = null;
      const cachedMember = guild?.members?.cache?.get(row.user_id);
      const member = cachedMember || (guild ? await guild.members.fetch(row.user_id).catch(() => null) : null);
      const user = member?.user || (await client.users.fetch(row.user_id).catch(() => null));
      label = member?.displayName || user?.globalName || user?.username || null;
      return { ...row, label: label || `Member ${String(row.user_id).slice(-4)}` };
    }),
  );
}

async function participantLabelsForImage(client, guildId, ids) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  return Promise.all(
    ids.map(async (id) => {
      const cachedMember = guild?.members?.cache?.get(id);
      const member = cachedMember || (guild ? await guild.members.fetch(id).catch(() => null) : null);
      const user = member?.user || (await client.users.fetch(id).catch(() => null));
      return member?.displayName || user?.globalName || user?.username || `Member ${String(id).slice(-4)}`;
    }),
  );
}

async function leaderboardMeta(guildId, season) {
  const rows = await overallLeaderboard(guildId, season, 20, 0);
  const weeks = await listEwcWeeks(guildId, season);
  const scoredWeeks = weeks.filter((week) => week.status === 'scored').length;
  const seasonRound = await getEwcSeason(guildId, season);
  const bestWeeks = seasonRound?.best_weeks || null;
  const championPickVisible = Boolean(
    seasonRound && (seasonRound.status === 'closed' || seasonRound.status === 'scored' || (seasonRound.close_at && nowSec() >= seasonRound.close_at)),
  );
  const championPicks = championPickVisible
    ? new Map((await listSeasonPredictions(guildId, season)).map((prediction) => [prediction.user_id, prediction.picks?.[0] || null]))
    : new Map();
  return {
    rows: rows.map((row) => ({
      ...row,
      championPick: championPickVisible ? championPicks.get(row.user_id) || null : null,
    })),
    weeks,
    scoredWeeks,
    bestWeeks,
    championPickVisible,
  };
}

// Members with a prediction in any round that is STILL OPEN (picks not yet
// revealed). Returns deduped user IDs ONLY — never picks — so the leaderboard can
// show "who's playing" without leaking anyone's choices before each game locks.
export async function openRoundParticipantIds(guildId, season) {
  const ids = new Set();
  for (const week of await listEwcWeeks(guildId, season)) {
    const label = effectiveEwcWeekStatus(week).label;
    if (label === 'open' || label === 'partly open') {
      for (const prediction of await listWeeklyPredictions(week.id)) {
        if (prediction.user_id) ids.add(prediction.user_id);
      }
    }
  }
  const seasonRound = await getEwcSeason(guildId, season);
  const seasonOpen =
    seasonRound && seasonRound.status === 'open' && !(seasonRound.close_at && nowSec() >= seasonRound.close_at);
  if (seasonOpen) {
    for (const prediction of await listSeasonPredictions(guildId, season)) {
      if (prediction.user_id) ids.add(prediction.user_id);
    }
  }
  return [...ids];
}

// True when members can still make ANY EWC prediction right now: a weekly week is
// effectively open, or the season round is open. Drives the leaderboard's picks button.
export async function anyRoundOpen(guildId, season) {
  const weeklyOpen = (await listEwcWeeks(guildId, season)).some((w) => {
    const label = effectiveEwcWeekStatus(w).label;
    return label === 'open' || label === 'partly open';
  });
  if (weeklyOpen) return true;
  const seasonRound = await getEwcSeason(guildId, season);
  return Boolean(seasonRound && seasonRound.status === 'open' && !(seasonRound.close_at && nowSec() >= seasonRound.close_at));
}

function participatingField(ids) {
  if (!ids.length) return null;
  const CAP = 40;
  const shown = ids.slice(0, CAP).map((id) => `<@${id}>`).join(' ');
  const more = ids.length > CAP ? ` +${ids.length - CAP} more` : '';
  return {
    name: `🎯 Predicting now (${ids.length})`,
    value: `${shown}${more}\n-# Picks stay hidden until each game locks.`.slice(0, 1024),
    inline: false,
  };
}

async function buildEwcPredictionLeaderboardPayload(client, guildId, season) {
  const { rows, weeks, scoredWeeks, bestWeeks, championPickVisible } = await leaderboardMeta(guildId, season);
  const namedRows = await leaderboardRowsForImage(client, guildId, rows);
  const participantIds = await openRoundParticipantIds(guildId, season);
  const participantLabels = await participantLabelsForImage(client, guildId, participantIds.slice(0, 18));
  const imageName = `ewc-predictions-${season}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(
    renderEwcPredictionLeaderboardCard({
      season,
      rows: namedRows,
      participantLabels,
      participantCount: participantIds.length,
      scoredWeeks,
      totalWeeks: weeks.length,
      bestWeeks,
      championPickVisible,
      updatedAt: Date.now(),
    }),
    { name: imageName },
  );
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`EWC ${season} Prediction Leaderboard`)
    .setImage(`attachment://${imageName}`)
    .addFields(
      { name: 'Scored weeks', value: `${scoredWeeks}/${weeks.length || 0}`, inline: true },
      { name: 'Overall rule', value: bestWeeks ? `Best ${bestWeeks} weeks + season` : 'All weeks + season', inline: true },
      { name: 'Champion picks', value: championPickVisible ? 'Shown' : 'Hidden until season locks', inline: true },
      { name: 'Updated', value: `<t:${nowSec()}:R>`, inline: true },
    )
    .setFooter({ text: 'Weekly and season prediction points' });
  const participating = participatingField(participantIds);
  if (participating) embed.addFields(participating);
  const open = await anyRoundOpen(guildId, season);
  const components = open
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ewc_predict:open:${season}`).setLabel('🎯 Open my picks').setStyle(ButtonStyle.Primary),
      )]
    : [];
  return { embeds: [embed], files: [attachment], components };
}

async function buildEwcPredictionMentionsEmbed(guildId, season) {
  const { rows, weeks, scoredWeeks, bestWeeks, championPickVisible } = await leaderboardMeta(guildId, season);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`EWC ${season} Prediction Leaderboard - Admin Mentions`)
    .setDescription(leaderboardLines(rows, { championPickVisible }))
    .addFields(
      { name: 'Scored weeks', value: `${scoredWeeks}/${weeks.length || 0}`, inline: true },
      { name: 'Overall rule', value: bestWeeks ? `Best ${bestWeeks} weeks + season` : 'All weeks + season', inline: true },
      { name: 'Champion picks', value: championPickVisible ? 'Shown' : 'Hidden until season locks', inline: true },
      { name: 'Updated', value: `<t:${nowSec()}:R>`, inline: true },
    )
    .setFooter({ text: 'Mentions are shown for admin tracking; edits do not ping members.' });
  const participating = participatingField(await openRoundParticipantIds(guildId, season));
  if (participating) embed.addFields(participating);
  return embed;
}

export async function updateEwcPredictionLeaderboard(client, guildId) {
  if (!client) return false;
  const s = await getSettings(guildId);
  let updated = false;

  if (s.ewc_predictions_leaderboard_channel_id) {
    const channel = await client.channels.fetch(s.ewc_predictions_leaderboard_channel_id).catch(() => null);
    if (channel?.isTextBased?.()) {
      const season = s.ewc_predictions_leaderboard_season || '2026';
      const imagePayload = await buildEwcPredictionLeaderboardPayload(client, guildId, season);
      if (s.ewc_predictions_leaderboard_message_id) {
        const msg = await channel.messages.fetch(s.ewc_predictions_leaderboard_message_id).catch(() => null);
        if (msg) {
          await msg.edit({ ...imagePayload, attachments: [] });
          updated = true;
        }
      }
      if (!updated) {
        const sent = await channel.send(imagePayload);
        await setEwcPredictionsLeaderboardMessage(guildId, sent.id);
        logger.info(`[ewc-predictions] posted leaderboard ${sent.id} in guild ${guildId}`);
        updated = true;
      }
    }
  }

  if (s.ewc_predictions_mentions_channel_id) {
    const channel = await client.channels.fetch(s.ewc_predictions_mentions_channel_id).catch(() => null);
    if (channel?.isTextBased?.()) {
      const season = s.ewc_predictions_mentions_season || '2026';
      const payload = {
        embeds: [await buildEwcPredictionMentionsEmbed(guildId, season)],
        allowedMentions: { parse: [] },
      };
      let mentionUpdated = false;
      if (s.ewc_predictions_mentions_message_id) {
        const msg = await channel.messages.fetch(s.ewc_predictions_mentions_message_id).catch(() => null);
        if (msg) {
          await msg.edit(payload);
          mentionUpdated = true;
        }
      }
      if (!mentionUpdated) {
        const sent = await channel.send(payload);
        await setEwcPredictionsMentionsMessage(guildId, sent.id);
        logger.info(`[ewc-predictions] posted mentions leaderboard ${sent.id} in guild ${guildId}`);
      }
      updated = true;
    }
  }

  return updated;
}

// Returns true only when the message was actually posted, so open-week announcing
// can avoid stamping a week as announced when no channel is configured yet.
async function announce(client, guildId, content) {
  if (!client) return false;
  const channelId = (await getSettings(guildId)).ewc_predictions_channel_id;
  if (!channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  try {
    await channel.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.warn(`[ewc-predictions] announcement failed: ${error.message}`);
    return false;
  }
}

function gameName(game) {
  return [game?.game, game?.event].filter(Boolean).join(' — ') || String(game?.key || 'Game');
}

function gameLockLine(game) {
  const label = gameName(game).slice(0, 180);
  const lockAt = Number(game?.lockAt);
  return Number.isFinite(lockAt)
    ? `• ${label} — locks <t:${lockAt}:F> (<t:${lockAt}:R>)`
    : `• ${label} — lock TBD`;
}

function nextGameLock(games, now = nowSec()) {
  const locks = (Array.isArray(games) ? games : [])
    .map((game) => Number(game?.lockAt))
    .filter((lockAt) => Number.isFinite(lockAt) && lockAt > now);
  return locks.length ? Math.min(...locks) : null;
}

// Kept pure so the opening announcement remains testable without Discord. Weeks
// normally contain only a few games, but this maintains Discord's 2,000-char
// limit by splitting into at most two compact messages when necessary.
export function openingPredictionAnnouncementContents(round, now = nowSec()) {
  const games = Array.isArray(round?.games) ? round.games : [];
  const title = `## 🎯 EWC Weekly Predictions — ${round.label || round.week_key} is open!`;
  const intro = 'Each game locks independently before it starts. Make your picks with `/ewc_predict weekly`.';
  const nextLockAt = nextGameLock(games, now);
  const footer = nextLockAt
    ? `**Next lock:** <t:${nextLockAt}:F> (<t:${nextLockAt}:R>).`
    : 'Game locks will appear here when scheduled.';
  const lines = games.length ? ['**Games**', ...games.map(gameLockLine)] : [];
  const messages = [];
  let current = [title, intro, ...lines].filter(Boolean).join('\n');
  if (current.length <= 2000 - footer.length - 2) return [`${current}\n\n${footer}`];

  current = [title, intro, '**Games**'].join('\n');
  for (const line of lines.slice(1)) {
    if (`${current}\n${line}\n\n${footer}`.length > 2000 && messages.length === 0) {
      messages.push(current);
      current = [`## 🎯 ${round.label || round.week_key} — more game locks`, '**Games**'].join('\n');
    }
    // A configured game is always represented, even in the unusual oversized
    // round case; names are already bounded above to keep the message compact.
    current += `\n${line}`;
  }
  messages.push(`${current}\n\n${footer}`);
  return messages.slice(0, 2).map((message) => message.slice(0, 2000));
}

// Post a "picks are open" message once per week, the moment its open window begins,
// telling members it's open and when it closes. Only stamps open_announced_at when
// the message actually posted, so a week configured before its channel still gets
// announced later (but never after it has closed — see listEwcWeeksToAnnounceOpen).
async function announceOpenWeeks(client) {
  if (!client) return;
  for (const round of await listEwcWeeksToAnnounceOpen(nowSec())) {
    try {
      const contents = openingPredictionAnnouncementContents(round);
      const announced = await Promise.all(contents.map((content) => announce(client, round.guild_id, content)));
      if (announced.every(Boolean)) {
        await markEwcWeekOpenAnnounced(round.id);
        logger.info(`[ewc-predictions] announced open week ${round.guild_id}/${round.season}/${round.week_key}`);
      }
    } catch (error) {
      logger.error(`[ewc-predictions] open announce ${round.guild_id}/${round.season}/${round.week_key}: ${error.message}`);
    }
  }
}

function gameIsUnpicked(prediction, gameKey) {
  return !(Array.isArray(prediction?.picks) ? prediction.picks : []).some(
    (pick) => pick && typeof pick === 'object' && String(pick.gameKey || '') === String(gameKey),
  );
}

function predictionReminderContent(round, game, incompleteCount) {
  const lockAt = Number(game?.lockAt);
  return (
    `## ⏰ Prediction reminder — ${round.label || round.week_key}\n` +
    `**${gameName(game)}** locks <t:${lockAt}:F> (<t:${lockAt}:R>).\n` +
    `${incompleteCount} participant${incompleteCount === 1 ? '' : 's'} still need this game. Use \`/ewc_predict weekly\` to finish your picks.`
  );
}

async function sendPredictionReminder(client, guildId, content) {
  if (!client) return false;
  const channelId = (await getSettings(guildId)).ewc_predictions_channel_id;
  if (!channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  try {
    await channel.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.warn(`[ewc-predictions] reminder failed: ${error.message}`);
    return false;
  }
}

export async function sendDueEwcPredictionReminders(
  client,
  { now = nowSec(), enabled = config.ewcPredictions.remindersEnabled, reminderHours = config.ewcPredictions.reminderHours } = {},
) {
  if (!client || !enabled) return 0;
  const reminderWindow = Math.min(24, Math.max(1, Number(reminderHours) || 6)) * 3600;
  let sent = 0;

  for (const round of await listOpenEwcWeeksForReminders()) {
    if (round.open_at && now < round.open_at) continue;
    const predictions = await listWeeklyPredictions(round.id);
    if (!predictions.length) continue;
    for (const game of Array.isArray(round.games) ? round.games : []) {
      const lockAt = Number(game?.lockAt);
      if (!game?.key || !Number.isFinite(lockAt) || lockAt <= now || lockAt - now > reminderWindow) continue;
      const incompleteCount = predictions.filter((prediction) => gameIsUnpicked(prediction, game.key)).length;
      if (!incompleteCount) continue;
      const kind = 'pre_lock';
      const claimToken = await claimEwcPredictionReminder({
        guildId: round.guild_id,
        weekId: round.id,
        gameKey: String(game.key),
        kind,
        nowSec: now,
      });
      if (!claimToken) continue;

      const didSend = await sendPredictionReminder(client, round.guild_id, predictionReminderContent(round, game, incompleteCount));
      if (!didSend) {
        await releaseEwcPredictionReminderClaim({
          guildId: round.guild_id,
          weekId: round.id,
          gameKey: String(game.key),
          kind,
          claimToken,
        });
        continue;
      }
      const finalized = await markEwcPredictionReminderSent({
        guildId: round.guild_id,
        weekId: round.id,
        gameKey: String(game.key),
        kind,
        claimToken,
      });
      if (finalized) sent += 1;
      else logger.warn(`[ewc-predictions] reminder delivery could not be finalized for ${round.guild_id}/${round.week_key}/${game.key}`);
    }
  }
  return sent;
}

async function syncLinkedProfileShowcases(guildId = null, season = null) {
  if (!config.dashboard.internalUrl || !config.dashboard.internalSecret) return;
  const links = await listEwcProfileLinks({ guildId, season });
  if (!links.length) return;
  const base = config.dashboard.internalUrl.replace(/\/$/, '');
  for (const link of links) {
    try {
      const response = await fetch(`${base}/api/internal/ewc-profile/sync`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          'x-ewc-internal-secret': config.dashboard.internalSecret,
        },
        body: JSON.stringify({
          discordUserId: link.discordUserId,
          guildId: guildId || link.guildId,
          season: season || link.season,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(body || `HTTP ${response.status}`);
      }
    } catch (error) {
      logger.warn(`[ewc-predictions] profile showcase sync failed for ${link.discordUserId}: ${error.message}`);
    }
  }
}

let initialProfileShowcaseSyncComplete = false;

async function processWeek(client, round) {
  const now = nowSec();
  const perGame = Array.isArray(round.games) && round.games.length > 0;

  // Aggregate (3-club) weeks need a baseline snapshot; per-game weeks do not.
  const baselineAt = round.close_at || round.open_at;
  if (!perGame && !round.baseline?.length && baselineAt && now >= baselineAt) {
    const baseline = await standingsFor(round.season);
    if (!baseline) {
      logger.warn(`[ewc-predictions] baseline pending for ${round.guild_id}/${round.season}/${round.week_key}: standings unavailable`);
      return;
    }
    await setEwcWeekSnapshot(round.id, 'baseline', baseline);
    round.baseline = baseline;
    logger.info(`[ewc-predictions] saved baseline for ${round.guild_id}/${round.season}/${round.week_key}`);
  }

  if (!round.close_at || now < round.close_at) return;

  if (round.status === 'open') {
    await setEwcWeekStatus(round.id, 'closed');
    round.status = 'closed';
    logger.info(`[ewc-predictions] closed picks for ${round.guild_id}/${round.season}/${round.week_key}`);
  }

  const readyAt = scoreAfter(round);
  if (!perGame && readyAt && now < readyAt) {
    logger.debug(`[ewc-predictions] scoring waits until ${readyAt} for ${round.guild_id}/${round.season}/${round.week_key}`);
    return;
  }

  if (!perGame && !round.baseline?.length) {
    logger.warn(`[ewc-predictions] cannot score ${round.guild_id}/${round.season}/${round.week_key}: no baseline snapshot`);
    return;
  }

  // Per-game rounds publish rolling points as each event's official prize table
  // lands. Poll only events near their scheduled finish, and keep completed
  // snapshots so later runs never spend another Liquipedia request on them.
  let results = perGame ? round.results || [] : [];
  let resultsChanged = false;
  if (perGame) {
    const candidates = readyAt && now >= readyAt
      ? dueEwcGamesForResults(round.games, results, now, Number.MAX_SAFE_INTEGER)
      : dueEwcGamesForResults(round.games, results, now);
    if (candidates.length) {
      const resolvedCandidates = await Promise.all(candidates.map(async (game) => ({
        ...game,
        eventUrl: await resolveEwcGameEventUrl(game.game, {
          guildId: round.guild_id,
          eventUrl: game.eventUrl,
          eventName: game.event,
        }),
      })));
      const fetched = await fetchEwcWeekGameResults(resolvedCandidates);
      const merged = mergeEwcGameResults(results, fetched);
      resultsChanged = JSON.stringify(merged) !== JSON.stringify(results);
      results = merged;
      round.results = results;
    }
  }

  const missingResults = perGame ? pendingEwcGameResults(results, round.games) : [];
  const predictions = await listWeeklyPredictions(round.id);

  const hasCompletedResult = results.some((result) => !ewcGameResultPending(result));
  const finalReady = perGame && (!readyAt || now >= readyAt) && missingResults.length === 0;
  if (perGame && !finalReady && hasCompletedResult && (resultsChanged || predictions.some((prediction) => prediction.score == null))) {
    await transaction(async (tx) => {
      for (const prediction of predictions) {
        try {
          const provisional = scorePerGameWeeklyPrediction(prediction.picks, round.games, results);
          await saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, provisional.score, {
            ...provisional.details,
            provisional: true,
          }, tx);
        } catch (error) {
          logger.warn(`[ewc-predictions] skipped malformed provisional pick ${prediction.user_id}/${round.week_key}: ${error.message}`);
          await saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, 0, {
            error: error.message,
            picks: prediction.picks,
            provisional: true,
          }, tx);
        }
      }
      await setEwcWeekResults(round.id, results, tx);
    });
    await updateEwcPredictionLeaderboard(client, round.guild_id);
    await syncLinkedProfileShowcases(round.guild_id, round.season);
  }

  if (perGame && readyAt && now < readyAt) {
    logger.debug(`[ewc-predictions] final weekly scoring waits until ${readyAt} for ${round.guild_id}/${round.season}/${round.week_key}`);
    return;
  }
  if (missingResults.length) {
    logger.warn(
      `[ewc-predictions] results pending for ${round.guild_id}/${round.season}/${round.week_key}: ${missingResults
        .map((result) => result.game || result.event || result.gameKey)
        .join(', ')}`,
    );
    return;
  }

  const final = perGame ? round.final || [] : round.final?.length ? round.final : await standingsFor(round.season);
  if (!perGame && !final?.length) {
    logger.warn(`[ewc-predictions] final pending for ${round.guild_id}/${round.season}/${round.week_key}: standings unavailable`);
    return;
  }

  // Wrap all writes in a transaction so a mid-loop crash leaves scores consistent.
  await transaction(async (tx) => {
    for (const prediction of predictions) {
      try {
        const result = perGame
          ? scorePerGameWeeklyPrediction(prediction.picks, round.games, results)
          : scoreWeeklyPrediction(prediction.picks, round.baseline, final);
        await saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, result.score, result.details, tx);
      } catch (error) {
        logger.warn(`[ewc-predictions] skipped malformed weekly pick ${prediction.user_id}/${round.week_key}: ${error.message}`);
        await saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, 0, {
          error: error.message,
          picks: prediction.picks,
        }, tx);
      }
    }
    if (perGame) await markEwcWeekScoredWithResults(round.id, final || [], results, tx);
    else await markEwcWeekScored(round.id, final, tx);
  });
  logger.info(
    `[ewc-predictions] scored ${predictions.length} weekly prediction(s) for ${round.guild_id}/${round.season}/${round.week_key} (${perGame ? 'per-game' : 'aggregate'})`,
  );
  const scored = await weeklyLeaderboard(round.id, 10, 0);
  await announce(
    client,
    round.guild_id,
    `## EWC Weekly Predictions Scored - ${round.label || round.week_key}\n${topPredictionLines(scored)}\n\nUse \`/ewc_predict leaderboard type:weekly week:${round.week_key}\` for the full board.`,
  );
  await updateEwcPredictionLeaderboard(client, round.guild_id);
  await syncLinkedProfileShowcases(round.guild_id, round.season);
}

async function processSeason(client, round) {
  if (round.status === 'open') {
    await setEwcSeasonStatus(round.guild_id, round.season, 'closed');
    logger.info(`[ewc-predictions] closed season picks for ${round.guild_id}/${round.season}`);
  }

  const readyAt = scoreAfter(round);
  if (readyAt && nowSec() < readyAt) {
    logger.debug(`[ewc-predictions] season scoring waits until ${readyAt} for ${round.guild_id}/${round.season}`);
    return;
  }

  const final = await standingsFor(round.season);
  if (!final?.length) {
    logger.warn(`[ewc-predictions] season scoring pending for ${round.guild_id}/${round.season}: standings unavailable`);
    return;
  }

  const predictions = await listSeasonPredictions(round.guild_id, round.season);
  // Wrap all writes in a transaction so a mid-loop crash leaves scores consistent.
  await transaction(async (tx) => {
    for (const prediction of predictions) {
      try {
        const result = scoreSeasonPrediction(prediction.picks, final, round.top_size);
        await saveSeasonPredictionScore(round.guild_id, round.season, prediction.user_id, result.score, result.details, tx);
      } catch (error) {
        logger.warn(`[ewc-predictions] skipped malformed season pick ${prediction.user_id}/${round.season}: ${error.message}`);
        await saveSeasonPredictionScore(round.guild_id, round.season, prediction.user_id, 0, {
          error: error.message,
          picks: prediction.picks,
        }, tx);
      }
    }
    await markEwcSeasonScored(round.guild_id, round.season, final, tx);
  });
  logger.info(`[ewc-predictions] scored ${predictions.length} season prediction(s) for ${round.guild_id}/${round.season}`);
  const scored = await seasonLeaderboard(round.guild_id, round.season, 10, 0);
  await announce(
    client,
    round.guild_id,
    `## EWC ${round.season} Season Predictions Scored\n${topPredictionLines(scored)}\n\nUse \`/ewc_predict leaderboard type:season\` for the full board.`,
  );
  await updateEwcPredictionLeaderboard(client, round.guild_id);
  await syncLinkedProfileShowcases(round.guild_id, round.season);
}

export async function runEwcPredictionAutomation(client = null) {
  const now = nowSec();
  await announceOpenWeeks(client);
  await sendDueEwcPredictionReminders(client, { now });
  const needsInitialProfileSync = !initialProfileShowcaseSyncComplete;
  initialProfileShowcaseSyncComplete = true;
  const weeks = await listEwcWeeksForAutomation(now);
  const seasons = await listEwcSeasonsForAutomation(now);

  for (const round of weeks) {
    try {
      await processWeek(client, round);
      await recordEwcPredictionAutomationHealth({ guildId: round.guild_id, season: round.season, ok: true }).catch((error) =>
        logger.warn(`[ewc-predictions] health ${round.guild_id}/${round.season}: ${error.message}`),
      );
    } catch (error) {
      logger.error(`[ewc-predictions] week ${round.guild_id}/${round.season}/${round.week_key}: ${error.message}`);
      await recordEwcPredictionAutomationHealth({ guildId: round.guild_id, season: round.season, ok: false, error: error.message }).catch((healthError) =>
        logger.warn(`[ewc-predictions] health ${round.guild_id}/${round.season}: ${healthError.message}`),
      );
    }
  }

  for (const round of seasons) {
    try {
      await processSeason(client, round);
      await recordEwcPredictionAutomationHealth({ guildId: round.guild_id, season: round.season, ok: true }).catch((error) =>
        logger.warn(`[ewc-predictions] health ${round.guild_id}/${round.season}: ${error.message}`),
      );
    } catch (error) {
      logger.error(`[ewc-predictions] season ${round.guild_id}/${round.season}: ${error.message}`);
      await recordEwcPredictionAutomationHealth({ guildId: round.guild_id, season: round.season, ok: false, error: error.message }).catch((healthError) =>
        logger.warn(`[ewc-predictions] health ${round.guild_id}/${round.season}: ${healthError.message}`),
      );
    }
  }

  for (const guildId of await getGuildsWithEwcPredictionLeaderboard()) {
    try {
      await updateEwcPredictionLeaderboard(client, guildId);
    } catch (error) {
      logger.error(`[ewc-predictions] leaderboard ${guildId}: ${error.message}`);
    }
  }

  // Profile repair is maintenance work. Run it after scoring so a slow internal
  // dashboard request can never delay official results or leaderboard points.
  if (needsInitialProfileSync) await syncLinkedProfileShowcases();
}

let timer = null;
let running = false;

export function startEwcPredictions(client) {
  const minutes = Math.max(15, config.ewcPredictions.refreshMinutes);
  // Guard against overlapping ticks: per-game scoring may make slow Liquipedia
  // fetches, so a tick can outlast the interval. Skip rather than stack runs.
  const run = async () => {
    if (running) {
      logger.debug('[ewc-predictions] previous automation run still active; skipping this tick');
      return;
    }
    running = true;
    try {
      await runEwcPredictionAutomation(client);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => run().catch((e) => logger.error(`[ewc-predictions] ${e.message}`)), minutes * 60 * 1000);
  timer.unref?.();
  logger.info(`[ewc-predictions] automation check every ${minutes}m.`);
  run().catch((e) => logger.error(`[ewc-predictions] ${e.message}`));
}

export function stopEwcPredictions() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
