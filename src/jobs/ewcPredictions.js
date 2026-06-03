import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import {
  listEwcWeeks,
  listEwcSeasonsForAutomation,
  listEwcWeeksForAutomation,
  listSeasonPredictions,
  listWeeklyPredictions,
  markEwcSeasonScored,
  markEwcWeekScored,
  overallLeaderboard,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  setEwcSeasonStatus,
  setEwcWeekSnapshot,
  setEwcWeekStatus,
} from '../db/ewcPredictions.js';
import {
  getGuildsWithEwcPredictionLeaderboard,
  getSettings,
  setEwcPredictionsLeaderboardMessage,
} from '../db/settings.js';
import { logger } from '../lib/logger.js';
import { scoreSeasonPrediction, scoreWeeklyPrediction } from '../lib/ewcPredictions.js';
import { fetchEwcClubStandings } from '../services/liquipedia.js';

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

function leaderboardLines(rows) {
  if (!rows.length) return 'No scored predictions yet.';
  return rows
    .slice(0, 20)
    .map((row, index) => `**${index + 1}.** <@${row.user_id}> - \`${Number(row.score || 0).toLocaleString()}\``)
    .join('\n');
}

function buildEwcPredictionLeaderboardEmbed(guildId, season) {
  const rows = overallLeaderboard(guildId, season, 20, 0);
  const weeks = listEwcWeeks(guildId, season);
  const scoredWeeks = weeks.filter((week) => week.status === 'scored').length;
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`EWC ${season} Prediction Leaderboard`)
    .setDescription(leaderboardLines(rows))
    .addFields(
      { name: 'Scored weeks', value: `${scoredWeeks}/${weeks.length || 0}`, inline: true },
      { name: 'Updated', value: `<t:${nowSec()}:R>`, inline: true },
    )
    .setFooter({ text: 'Weekly and season prediction points' });
}

export async function updateEwcPredictionLeaderboard(client, guildId) {
  if (!client) return false;
  const s = getSettings(guildId);
  if (!s.ewc_predictions_leaderboard_channel_id) return false;

  const channel = await client.channels.fetch(s.ewc_predictions_leaderboard_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const season = s.ewc_predictions_leaderboard_season || '2026';
  const payload = { embeds: [buildEwcPredictionLeaderboardEmbed(guildId, season)] };

  if (s.ewc_predictions_leaderboard_message_id) {
    const msg = await channel.messages.fetch(s.ewc_predictions_leaderboard_message_id).catch(() => null);
    if (msg) {
      await msg.edit(payload);
      return true;
    }
  }

  const sent = await channel.send(payload);
  setEwcPredictionsLeaderboardMessage(guildId, sent.id);
  logger.info(`[ewc-predictions] posted leaderboard ${sent.id} in guild ${guildId}`);
  return true;
}

async function announce(client, guildId, content) {
  if (!client) return;
  const channelId = getSettings(guildId).ewc_predictions_channel_id;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ content }).catch((error) => logger.warn(`[ewc-predictions] announcement failed: ${error.message}`));
}

async function processWeek(client, round) {
  const now = nowSec();

  const baselineAt = round.close_at || round.open_at;
  if (!round.baseline?.length && baselineAt && now >= baselineAt) {
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

  if (!round.baseline?.length) {
    logger.warn(`[ewc-predictions] cannot score ${round.guild_id}/${round.season}/${round.week_key}: no baseline snapshot`);
    return;
  }

  const final = round.final?.length ? round.final : await standingsFor(round.season);
  if (!final?.length) {
    logger.warn(`[ewc-predictions] final pending for ${round.guild_id}/${round.season}/${round.week_key}: standings unavailable`);
    return;
  }

  const predictions = listWeeklyPredictions(round.id);
  for (const prediction of predictions) {
    try {
      const result = scoreWeeklyPrediction(prediction.picks, round.baseline, final);
      saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, result.score, result.details);
    } catch (error) {
      logger.warn(`[ewc-predictions] skipped malformed weekly pick ${prediction.user_id}/${round.week_key}: ${error.message}`);
      saveWeeklyPredictionScore(round.guild_id, round.id, prediction.user_id, 0, {
        error: error.message,
        picks: prediction.picks,
      });
    }
  }
  markEwcWeekScored(round.id, final);
  logger.info(`[ewc-predictions] scored ${predictions.length} weekly prediction(s) for ${round.guild_id}/${round.season}/${round.week_key}`);
  const scored = listWeeklyPredictions(round.id);
  await announce(
    client,
    round.guild_id,
    `## EWC Weekly Predictions Scored - ${round.label || round.week_key}\n${topPredictionLines(scored)}\n\nUse \`/ewc_predict leaderboard type:weekly week:${round.week_key}\` for the full board.`,
  );
  await updateEwcPredictionLeaderboard(client, round.guild_id);
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
  logger.info(`[ewc-predictions] scored ${predictions.length} season prediction(s) for ${round.guild_id}/${round.season}`);
  const scored = listSeasonPredictions(round.guild_id, round.season);
  await announce(
    client,
    round.guild_id,
    `## EWC ${round.season} Season Predictions Scored\n${topPredictionLines(scored)}\n\nUse \`/ewc_predict leaderboard type:season\` for the full board.`,
  );
  await updateEwcPredictionLeaderboard(client, round.guild_id);
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

export function startEwcPredictions(client) {
  const minutes = Math.max(15, config.ewcPredictions.refreshMinutes);
  const run = () => runEwcPredictionAutomation(client).catch((e) => logger.error(`[ewc-predictions] ${e.message}`));
  timer = setInterval(run, minutes * 60 * 1000);
  timer.unref?.();
  logger.info(`[ewc-predictions] automation check every ${minutes}m.`);
  run();
}

export function stopEwcPredictions() {
  if (timer) clearInterval(timer);
  timer = null;
}
