import '../db/index.js';
import { db } from '../db/connection.js';
import {
  countOverallScored,
  overallLeaderboard,
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

function leaderboardRows(guildId, season, limit = 50, offset = 0) {
  return overallLeaderboard(guildId, season, clampLimit(limit), Math.max(0, Math.floor(Number(offset)) || 0));
}

function allLeaderboardRows(guildId, season) {
  return overallLeaderboard(guildId, season, 5000, 0);
}

function rankForUser(guildId, season, userId) {
  const rows = allLeaderboardRows(guildId, season);
  const index = rows.findIndex((row) => row.user_id === userId);
  if (index < 0) return { rank: null, score: 0 };
  return { rank: index + 1, score: Number(rows[index].score || 0) };
}

function weeklyAggregateStats(guildId, season, userId) {
  const weeklyRows = db
    .prepare(
      `SELECT wp.score, wp.details_json
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       WHERE wp.guild_id = ?
         AND w.season = ?
         AND wp.user_id = ?
         AND wp.score IS NOT NULL`,
    )
    .all(guildId, season, userId);

  const weeklyWins = db
    .prepare(
      `WITH winners AS (
         SELECT week_id, MAX(score) AS max_score
         FROM ewc_weekly_predictions
         WHERE guild_id = ? AND score IS NOT NULL
         GROUP BY week_id
       )
       SELECT COUNT(*) AS c
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       JOIN winners win ON win.week_id = wp.week_id AND win.max_score = wp.score
       WHERE wp.guild_id = ?
         AND w.season = ?
         AND wp.user_id = ?
         AND wp.score IS NOT NULL`,
    )
    .get(guildId, guildId, season, userId).c;

  return {
    weeksScored: weeklyRows.length,
    weeklyWins: Number(weeklyWins || 0),
    top3Sweeps: weeklyRows.filter((row) => Number(parseJson(row.details_json, {})?.bonus || 0) >= WEEKLY_TOP_THREE_SWEEP_BONUS)
      .length,
  };
}

function seasonPickTeams(profile) {
  return profile?.season?.picks?.length ? profile.season.picks.slice(0, 3) : [];
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

export function getEwcUserProfileStats(guildId, season = DEFAULT_EWC_PROFILE_SEASON, userId) {
  const rank = rankForUser(guildId, season, userId);
  const weekly = weeklyAggregateStats(guildId, season, userId);
  const profile = userPredictionProfile(guildId, season, userId);
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

export function getPublicEwcLeaderboard({ guildId, season = DEFAULT_EWC_PROFILE_SEASON, limit = 50, offset = 0 }) {
  const rows = leaderboardRows(guildId, season, limit, offset);
  const start = Math.max(0, Math.floor(Number(offset)) || 0);
  return {
    guildId,
    season,
    total: countOverallScored(guildId, season),
    rows: rows.map((row, index) => {
      const userId = row.user_id;
      const weekly = weeklyAggregateStats(guildId, season, userId);
      const profile = userPredictionProfile(guildId, season, userId);
      return {
        rank: start + index + 1,
        userId,
        displayName: memberLabel(userId),
        overallPoints: Number(row.score || 0),
        weeksScored: weekly.weeksScored,
        weeklyWins: weekly.weeklyWins,
        top3Sweeps: weekly.top3Sweeps,
        topTeams: seasonPickTeams(profile),
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

export function getEwcRoleConnectionPayload(guildId, season, userId) {
  return buildDiscordRoleConnectionPayload(getEwcUserProfileStats(guildId, season, userId));
}
