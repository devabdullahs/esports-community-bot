import { all, get } from '../db/client.js';
import {
  countOverallScored,
  overallLeaderboard,
  overallRankForUser,
  userPredictionProfile,
} from '../db/ewcPredictions.js';
import { WEEKLY_TOP_THREE_SWEEP_BONUS } from './ewcPredictions.js';

export const DEFAULT_EWC_PROFILE_SEASON = '2026';
const MAX_SHOWCASE_USERNAME = 100;
const UNRANKED_VALUE = 999999;

export const EWC_ROLE_CONNECTION_METADATA = [
  {
    type: 1,
    key: 'overall_rank',
    name: 'Overall Rank',
    description: 'EWC prediction overall leaderboard rank. Lower is better.',
  },
  {
    type: 2,
    key: 'overall_points',
    name: 'Overall Points',
    description: 'Total EWC prediction points earned by this member.',
  },
  {
    type: 2,
    key: 'weeks_scored',
    name: 'Weeks Scored',
    description: 'Number of scored EWC weekly prediction rounds.',
  },
  {
    type: 2,
    key: 'weekly_wins',
    name: 'Weekly Wins',
    description: 'Number of EWC weekly prediction rounds this member won or tied.',
  },
  {
    type: 2,
    key: 'top3_sweeps',
    name: 'Top 3 Sweeps',
    description: 'Number of weekly picks where all three clubs finished in the weekly top three.',
  },
];

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function memberLabel(userId) {
  return `Member ${String(userId).slice(-4)}`;
}

function clampLimit(limit, fallback = 50) {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

function placeholders(start, count) {
  return Array.from({ length: count }, (_value, index) => `$${start + index}`).join(', ');
}

async function leaderboardRows(guildId, season, limit = 50, offset = 0) {
  return overallLeaderboard(guildId, season, clampLimit(limit), Math.max(0, Math.floor(Number(offset)) || 0));
}

async function rankForUser(guildId, season, userId) {
  const row = await overallRankForUser(guildId, season, userId);
  if (!row) return { rank: null, score: 0 };
  return { rank: Number(row.rank), score: Number(row.score || 0) };
}

async function weeklyAggregateStats(guildId, season, userId) {
  const weeklyRows = await all(
    `SELECT wp.score, wp.details_json
     FROM ewc_weekly_predictions wp
     JOIN ewc_prediction_weeks w ON w.id = wp.week_id
     WHERE wp.guild_id = $1
       AND w.season = $2
       AND wp.user_id = $3
       AND wp.score IS NOT NULL`,
    [guildId, season, userId],
  );

  const weeklyWins = (
    await get(
      `WITH winners AS (
         SELECT wp.week_id, MAX(wp.score) AS max_score
         FROM ewc_weekly_predictions wp
         JOIN ewc_prediction_weeks w2 ON w2.id = wp.week_id
         WHERE wp.guild_id = $1 AND w2.season = $2 AND wp.score IS NOT NULL
         GROUP BY wp.week_id
       )
       SELECT COUNT(*) AS c
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       JOIN winners win ON win.week_id = wp.week_id AND win.max_score = wp.score
       WHERE wp.guild_id = $3
          AND w.season = $4
          AND wp.user_id = $5
          AND wp.score IS NOT NULL`,
      [guildId, season, guildId, season, userId],
    )
  )?.c;

  return {
    weeksScored: weeklyRows.length,
    weeklyWins: Number(weeklyWins || 0),
    top3Sweeps: weeklyRows.filter((row) => Number(parseJson(row.details_json, {})?.bonus || 0) >= WEEKLY_TOP_THREE_SWEEP_BONUS)
      .length,
  };
}

function emptyWeeklyAggregate() {
  return { weeksScored: 0, weeklyWins: 0, top3Sweeps: 0 };
}

async function weeklyAggregateStatsForUsers(guildId, season, userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const stats = new Map(uniqueIds.map((userId) => [userId, emptyWeeklyAggregate()]));
  if (!uniqueIds.length) return stats;

  const weeklyRows = await all(
    `SELECT wp.user_id, wp.week_id, wp.score, wp.details_json
     FROM ewc_weekly_predictions wp
     JOIN ewc_prediction_weeks w ON w.id = wp.week_id
     WHERE wp.guild_id = $1
       AND w.season = $2
       AND wp.score IS NOT NULL
       AND wp.user_id IN (${placeholders(3, uniqueIds.length)})`,
    [guildId, season, ...uniqueIds],
  );

  const winningRows = await all(
    `SELECT wp.week_id, MAX(wp.score) AS max_score
     FROM ewc_weekly_predictions wp
     JOIN ewc_prediction_weeks w ON w.id = wp.week_id
     WHERE wp.guild_id = $1
       AND w.season = $2
       AND wp.score IS NOT NULL
     GROUP BY wp.week_id`,
    [guildId, season],
  );
  const winningScoreByWeek = new Map(winningRows.map((row) => [row.week_id, Number(row.max_score || 0)]));

  for (const row of weeklyRows) {
    const current = stats.get(row.user_id) || emptyWeeklyAggregate();
    const score = Number(row.score || 0);
    current.weeksScored += 1;
    if (score === winningScoreByWeek.get(row.week_id)) current.weeklyWins += 1;
    if (Number(parseJson(row.details_json, {})?.bonus || 0) >= WEEKLY_TOP_THREE_SWEEP_BONUS) {
      current.top3Sweeps += 1;
    }
    stats.set(row.user_id, current);
  }

  return stats;
}

function seasonPickTeams(profile) {
  return profile?.season?.picks?.length ? profile.season.picks.slice(0, 3) : [];
}

async function seasonPickTeamsForUsers(guildId, season, userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const teams = new Map(uniqueIds.map((userId) => [userId, []]));
  if (!uniqueIds.length) return teams;

  const rows = await all(
    `SELECT user_id, picks_json
     FROM ewc_season_predictions
     WHERE guild_id = $1
       AND season = $2
       AND user_id IN (${placeholders(3, uniqueIds.length)})`,
    [guildId, season, ...uniqueIds],
  );

  for (const row of rows) {
    teams.set(row.user_id, parseJson(row.picks_json, []).slice(0, 3));
  }

  return teams;
}

function recentWeekly(profile) {
  return profile.weekly
    .filter((row) => row.picks?.length || row.score != null)
    .slice(-6)
    .reverse()
    .map((row) => ({
      weekKey: row.week_key,
      label: row.label || row.week_key,
      status: row.status,
      score: row.score == null ? null : Number(row.score),
      picks: row.picks || [],
      bonus: Number(row.details?.bonus || 0),
    }));
}

export function formatShowcaseUsername(stats) {
  const rank = stats.rank ? `#${stats.rank} overall` : 'Unranked';
  const points = `${Number(stats.overallPoints || 0).toLocaleString()} pts`;
  const teams = stats.topTeams?.length ? stats.topTeams.join(', ') : `${stats.weeksScored || 0} weeks`;
  const value = `${rank} | ${points} | ${teams}`;
  return value.length <= MAX_SHOWCASE_USERNAME ? value : `${value.slice(0, MAX_SHOWCASE_USERNAME - 3)}...`;
}

export async function getEwcUserProfileStats(guildId, season = DEFAULT_EWC_PROFILE_SEASON, userId) {
  const rank = await rankForUser(guildId, season, userId);
  const weekly = await weeklyAggregateStats(guildId, season, userId);
  const profile = await userPredictionProfile(guildId, season, userId);
  const topTeams = seasonPickTeams(profile);
  const stats = {
    guildId,
    season,
    userId,
    displayName: memberLabel(userId),
    rank: rank.rank,
    overallPoints: rank.score,
    weeksScored: weekly.weeksScored,
    weeklyWins: weekly.weeklyWins,
    top3Sweeps: weekly.top3Sweeps,
    topTeams,
    seasonPicks: profile.season?.picks || [],
    seasonScore: profile.season?.score == null ? null : Number(profile.season.score),
    recentWeekly: recentWeekly(profile),
  };
  return {
    ...stats,
    showcaseUsername: formatShowcaseUsername(stats),
  };
}

export async function getPublicEwcLeaderboard({ guildId, season = DEFAULT_EWC_PROFILE_SEASON, limit = 50, offset = 0 }) {
  const rows = await leaderboardRows(guildId, season, limit, offset);
  const start = Math.max(0, Math.floor(Number(offset)) || 0);
  const topRows = start === 0 && rows.length ? rows : await leaderboardRows(guildId, season, 1, 0);
  const userIds = rows.map((row) => row.user_id);
  const weeklyByUser = await weeklyAggregateStatsForUsers(guildId, season, userIds);
  const topTeamsByUser = await seasonPickTeamsForUsers(guildId, season, userIds);
  return {
    guildId,
    season,
    total: await countOverallScored(guildId, season),
    topScore: Number(topRows[0]?.score || 0),
    rows: rows.map((row, index) => {
      const userId = row.user_id;
      const weekly = weeklyByUser.get(userId) || emptyWeeklyAggregate();
      return {
        rank: start + index + 1,
        displayName: memberLabel(userId),
        overallPoints: Number(row.score || 0),
        weeksScored: weekly.weeksScored,
        weeklyWins: weekly.weeklyWins,
        top3Sweeps: weekly.top3Sweeps,
        topTeams: topTeamsByUser.get(userId) || [],
      };
    }),
  };
}

export function buildDiscordRoleConnectionPayload(stats) {
  return {
    platform_name: 'EWC Predictions',
    platform_username: stats.showcaseUsername || formatShowcaseUsername(stats),
    metadata: {
      overall_rank: String(stats.rank || UNRANKED_VALUE),
      overall_points: String(Math.max(0, Math.floor(Number(stats.overallPoints || 0)))),
      weeks_scored: String(Math.max(0, Math.floor(Number(stats.weeksScored || 0)))),
      weekly_wins: String(Math.max(0, Math.floor(Number(stats.weeklyWins || 0)))),
      top3_sweeps: String(Math.max(0, Math.floor(Number(stats.top3Sweeps || 0)))),
    },
  };
}

export async function getEwcRoleConnectionPayload(guildId, season, userId) {
  return buildDiscordRoleConnectionPayload(await getEwcUserProfileStats(guildId, season, userId));
}
