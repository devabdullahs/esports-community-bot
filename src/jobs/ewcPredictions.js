import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import {
  listEwcWeeks,
  listEwcSeasonsForAutomation,
  listEwcWeeksForAutomation,
  getEwcSeason,
  listSeasonPredictions,
  listWeeklyPredictions,
  markEwcSeasonScored,
  markEwcWeekScored,
  markEwcWeekScoredWithResults,
  overallLeaderboard,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  setEwcSeasonStatus,
  setEwcWeekSnapshot,
  setEwcWeekStatus,
} from '../db/ewcPredictions.js';
import { listEwcProfileLinks } from '../db/ewcProfileLinks.js';
import {
  getGuildsWithEwcPredictionLeaderboard,
  getSettings,
  setEwcPredictionsMentionsMessage,
  setEwcPredictionsLeaderboardMessage,
} from '../db/settings.js';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import {
  pendingEwcGameResults,
  scorePerGameWeeklyPrediction,
  scoreSeasonPrediction,
  scoreWeeklyPrediction,
} from '../lib/ewcPredictions.js';
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

function topPredictionLines(predictions) {
  const rows = predictions
    .filter((prediction) => prediction.score != null)
    .sort((a, b) => b.score - a.score || String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
    .slice(0, 10);
  if (!rows.length) return 'No scored predictions.';
  return rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> - \`${Number(row.score).toLocaleString()}\``).join('\n');
}

function leaderboardLines(rows, { championPickVisible = false } = {}) {
  if (!rows.length) return 'No scored predictions yet.';
  return rows
    .slice(0, 20)
    .map((row, index) => {
      const pick = championPickVisible ? ` - Champion pick: **${row.championPick || '-'}**` : '';
      return `**${index + 1}.** <@${row.user_id}> - \`${Number(row.score || 0).toLocaleString()}\`${pick}`;
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

function leaderboardMeta(guildId, season) {
  const rows = overallLeaderboard(guildId, season, 20, 0);
  const weeks = listEwcWeeks(guildId, season);
  const scoredWeeks = weeks.filter((week) => week.status === 'scored').length;
  const seasonRound = getEwcSeason(guildId, season);
  const bestWeeks = seasonRound?.best_weeks || null;
  const championPickVisible = Boolean(
    seasonRound && (seasonRound.status === 'closed' || seasonRound.status === 'scored' || (seasonRound.close_at && nowSec() >= seasonRound.close_at)),
  );
  const championPicks = championPickVisible
    ? new Map(listSeasonPredictions(guildId, season).map((prediction) => [prediction.user_id, prediction.picks?.[0] || null]))
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

async function buildEwcPredictionLeaderboardPayload(client, guildId, season) {
  const { rows, weeks, scoredWeeks, bestWeeks, championPickVisible } = leaderboardMeta(guildId, season);
  const namedRows = await leaderboardRowsForImage(client, guildId, rows);
  const imageName = `ewc-predictions-${season}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(
    renderEwcPredictionLeaderboardCard({
      season,
      rows: namedRows,
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
  return { embeds: [embed], files: [attachment] };
}

function buildEwcPredictionMentionsEmbed(guildId, season) {
  const { rows, weeks, scoredWeeks, bestWeeks, championPickVisible } = leaderboardMeta(guildId, season);
  return new EmbedBuilder()
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
}

export async function updateEwcPredictionLeaderboard(client, guildId) {
  if (!client) return false;
  const s = getSettings(guildId);
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
        setEwcPredictionsLeaderboardMessage(guildId, sent.id);
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
        embeds: [buildEwcPredictionMentionsEmbed(guildId, season)],
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
        setEwcPredictionsMentionsMessage(guildId, sent.id);
        logger.info(`[ewc-predictions] posted mentions leaderboard ${sent.id} in guild ${guildId}`);
      }
      updated = true;
    }
  }

  return updated;
}

async function announce(client, guildId, content) {
  if (!client) return;
  const channelId = getSettings(guildId).ewc_predictions_channel_id;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ content }).catch((error) => logger.warn(`[ewc-predictions] announcement failed: ${error.message}`));
}

async function syncLinkedProfileShowcases(guildId, season) {
  if (!config.dashboard.internalUrl || !config.dashboard.internalSecret) return;
  const links = await listEwcProfileLinks({ guildId, season });
  if (!links.length) return;
  const base = config.dashboard.internalUrl.replace(/\/$/, '');
  for (const link of links) {
    try {
      const response = await fetch(`${base}/api/internal/ewc-profile/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ewc-internal-secret': config.dashboard.internalSecret,
        },
        body: JSON.stringify({
          discordUserId: link.discordUserId,
          guildId,
          season,
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
    setEwcWeekSnapshot(round.id, 'baseline', baseline);
    round.baseline = baseline;
    logger.info(`[ewc-predictions] saved baseline for ${round.guild_id}/${round.season}/${round.week_key}`);
  }

  if (!round.close_at || now < round.close_at) return;

  if (round.status === 'open') {
    setEwcWeekStatus(round.id, 'closed');
    round.status = 'closed';
    logger.info(`[ewc-predictions] closed picks for ${round.guild_id}/${round.season}/${round.week_key}`);
  }

  const readyAt = scoreAfter(round);
  if (readyAt && now < readyAt) {
    logger.debug(`[ewc-predictions] scoring waits until ${readyAt} for ${round.guild_id}/${round.season}/${round.week_key}`);
    return;
  }

  if (!perGame && !round.baseline?.length) {
    logger.warn(`[ewc-predictions] cannot score ${round.guild_id}/${round.season}/${round.week_key}: no baseline snapshot`);
    return;
  }

  // Network fetch + pending-results check happen OUTSIDE the transaction below.
  const results = perGame ? (round.results?.length ? round.results : await fetchEwcWeekGameResults(round.games)) : [];
  const missingResults = perGame ? pendingEwcGameResults(results, round.games) : [];
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

  const predictions = listWeeklyPredictions(round.id);
  // Wrap all writes in a transaction so a mid-loop crash leaves scores consistent.
  const applyScores = db.transaction(() => {
    for (const prediction of predictions) {
      try {
        const result = perGame
          ? scorePerGameWeeklyPrediction(prediction.picks, round.games, results)
          : scoreWeeklyPrediction(prediction.picks, round.baseline, final);
        saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, result.score, result.details);
      } catch (error) {
        logger.warn(`[ewc-predictions] skipped malformed weekly pick ${prediction.user_id}/${round.week_key}: ${error.message}`);
        saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, 0, {
          error: error.message,
          picks: prediction.picks,
        });
      }
    }
    if (perGame) markEwcWeekScoredWithResults(round.id, final || [], results);
    else markEwcWeekScored(round.id, final);
  });
  applyScores();
  logger.info(
    `[ewc-predictions] scored ${predictions.length} weekly prediction(s) for ${round.guild_id}/${round.season}/${round.week_key} (${perGame ? 'per-game' : 'aggregate'})`,
  );
  const scored = listWeeklyPredictions(round.id);
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
    setEwcSeasonStatus(round.guild_id, round.season, 'closed');
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

  const predictions = listSeasonPredictions(round.guild_id, round.season);
  // Wrap all writes in a transaction so a mid-loop crash leaves scores consistent.
  const applyScores = db.transaction(() => {
    for (const prediction of predictions) {
      try {
        const result = scoreSeasonPrediction(prediction.picks, final, round.top_size);
        saveSeasonPredictionScore(round.guild_id, round.season, prediction.user_id, result.score, result.details);
      } catch (error) {
        logger.warn(`[ewc-predictions] skipped malformed season pick ${prediction.user_id}/${round.season}: ${error.message}`);
        saveSeasonPredictionScore(round.guild_id, round.season, prediction.user_id, 0, {
          error: error.message,
          picks: prediction.picks,
        });
      }
    }
    markEwcSeasonScored(round.guild_id, round.season, final);
  });
  applyScores();
  logger.info(`[ewc-predictions] scored ${predictions.length} season prediction(s) for ${round.guild_id}/${round.season}`);
  const scored = listSeasonPredictions(round.guild_id, round.season);
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
  const weeks = listEwcWeeksForAutomation(now);
  const seasons = listEwcSeasonsForAutomation(now);

  for (const round of weeks) {
    try {
      await processWeek(client, round);
    } catch (error) {
      logger.error(`[ewc-predictions] week ${round.guild_id}/${round.season}/${round.week_key}: ${error.message}`);
    }
  }

  for (const round of seasons) {
    try {
      await processSeason(client, round);
    } catch (error) {
      logger.error(`[ewc-predictions] season ${round.guild_id}/${round.season}: ${error.message}`);
    }
  }

  for (const guildId of getGuildsWithEwcPredictionLeaderboard()) {
    try {
      await updateEwcPredictionLeaderboard(client, guildId);
    } catch (error) {
      logger.error(`[ewc-predictions] leaderboard ${guildId}: ${error.message}`);
    }
  }
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
