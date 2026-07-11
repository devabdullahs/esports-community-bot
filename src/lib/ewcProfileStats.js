import { all, get } from '../db/client.js';
import {
  countOverallScored,
  getEwcSeason,
  overallLeaderboard,
  overallRankForUser,
  userPredictionProfile,
} from '../db/ewcPredictions.js';
import { WEEKLY_TOP_THREE_SWEEP_BONUS } from './ewcPredictions.js';
import { projectSeasonScoreBreakdown, projectWeeklyScoreBreakdown } from './ewcPredictionBreakdown.js';
import { scoreBreakdownVisible, seasonPicksVisible } from './ewcPredictionVisibility.js';
import { publicEwcProfileIdentitiesByDiscordUserIds } from '../db/ewcProfileLinks.js';

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
    // Keep the existing key so guild role requirements survive this semantic fix.
    key: 'weeks_scored',
    name: 'Weeks Predicted',
    description: 'Number of EWC weekly prediction rounds this member submitted.',
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
    `SELECT wp.score, wp.details_json, w.status AS week_status
     FROM ewc_weekly_predictions wp
     JOIN ewc_prediction_weeks w ON w.id = wp.week_id
     WHERE wp.guild_id = $1
       AND w.season = $2
       AND wp.user_id = $3`,
    [guildId, season, userId],
  );
  const scoredRows = weeklyRows.filter((row) => row.score != null && row.week_status === 'scored');

  const weeklyWins = (
    await get(
      `WITH winners AS (
         SELECT wp.week_id, MAX(wp.score) AS max_score
         FROM ewc_weekly_predictions wp
         JOIN ewc_prediction_weeks w2 ON w2.id = wp.week_id
         WHERE wp.guild_id = $1 AND w2.season = $2 AND w2.status = 'scored' AND wp.score IS NOT NULL
         GROUP BY wp.week_id
       )
       SELECT COUNT(*) AS c
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       JOIN winners win ON win.week_id = wp.week_id AND win.max_score = wp.score
       WHERE wp.guild_id = $3
          AND w.season = $4
          AND w.status = 'scored'
          AND wp.user_id = $5
          AND wp.score IS NOT NULL
          AND win.max_score > 0`,
      [guildId, season, guildId, season, userId],
    )
  )?.c;

  return {
    weeksPredicted: weeklyRows.length,
    weeksScored: scoredRows.length,
    weeklyWins: Number(weeklyWins || 0),
    top3Sweeps: scoredRows.filter((row) => Number(parseJson(row.details_json, {})?.bonus || 0) >= WEEKLY_TOP_THREE_SWEEP_BONUS)
      .length,
  };
}

function emptyWeeklyAggregate() {
  return { weeksPredicted: 0, weeksScored: 0, weeklyWins: 0, top3Sweeps: 0 };
}

async function weeklyAggregateStatsForUsers(guildId, season, userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const stats = new Map(uniqueIds.map((userId) => [userId, emptyWeeklyAggregate()]));
  if (!uniqueIds.length) return stats;

  const weeklyRows = await all(
    `SELECT wp.user_id, wp.week_id, wp.score, wp.details_json, w.status AS week_status
     FROM ewc_weekly_predictions wp
     JOIN ewc_prediction_weeks w ON w.id = wp.week_id
     WHERE wp.guild_id = $1
       AND w.season = $2
       AND wp.user_id IN (${placeholders(3, uniqueIds.length)})`,
    [guildId, season, ...uniqueIds],
  );

  const winningRows = await all(
    `SELECT wp.week_id, MAX(wp.score) AS max_score
     FROM ewc_weekly_predictions wp
     JOIN ewc_prediction_weeks w ON w.id = wp.week_id
     WHERE wp.guild_id = $1
       AND w.season = $2
       AND w.status = 'scored'
       AND wp.score IS NOT NULL
     GROUP BY wp.week_id`,
    [guildId, season],
  );
  const winningScoreByWeek = new Map(winningRows.map((row) => [row.week_id, Number(row.max_score || 0)]));

  for (const row of weeklyRows) {
    const current = stats.get(row.user_id) || emptyWeeklyAggregate();
    current.weeksPredicted += 1;
    if (row.score == null || row.week_status !== 'scored') {
      stats.set(row.user_id, current);
      continue;
    }
    const score = Number(row.score || 0);
    current.weeksScored += 1;
    if (score > 0 && score === winningScoreByWeek.get(row.week_id)) current.weeklyWins += 1;
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

async function seasonPickTeamsForUsers(guildId, season, userIds, { includeHiddenPicks = false } = {}) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const teams = new Map(uniqueIds.map((userId) => [userId, []]));
  if (!uniqueIds.length) return teams;

  const round = await getEwcSeason(guildId, season);
  if (!includeHiddenPicks && !seasonPicksVisible(round)) return teams;

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

// A weekly pick is either a legacy aggregate club (plain string) or a per-game
// entry object `{ gameKey, game, event, pick }`. Render both as display strings so
// the web/profile surfaces never leak "[object Object]" from a raw object.
export function formatWeeklyPickLabel(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return '';
  const label = String(entry.game || entry.gameKey || '').trim();
  const team = String(entry.pick || '').trim();
  if (label && team) return `${label}: ${team}`;
  return team || label || '';
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
      picks: (row.picks || []).map(formatWeeklyPickLabel).filter(Boolean),
      bonus: Number(row.details?.bonus || 0),
      breakdown: scoreBreakdownVisible(row) ? projectWeeklyScoreBreakdown(row) : null,
    }));
}

export function formatShowcaseUsername(stats) {
  const rank = stats.rank ? `#${stats.rank} overall` : 'Unranked';
  const points = `${Number(stats.overallPoints || 0).toLocaleString()} pts`;
  const teams = stats.seasonPicksHidden
    ? 'picks hidden'
    : stats.topTeams?.length
      ? stats.topTeams.join(', ')
      : `${stats.weeksPredicted ?? stats.weeksScored ?? 0} weeks`;
  const value = `${rank} | ${points} | ${teams}`;
  return value.length <= MAX_SHOWCASE_USERNAME ? value : `${value.slice(0, MAX_SHOWCASE_USERNAME - 3)}...`;
}

export async function getEwcUserProfileStats(guildId, season = DEFAULT_EWC_PROFILE_SEASON, userId, { includeHiddenPicks = false } = {}) {
  const rank = await rankForUser(guildId, season, userId);
  const weekly = await weeklyAggregateStats(guildId, season, userId);
  const profile = await userPredictionProfile(guildId, season, userId);
  const round = await getEwcSeason(guildId, season);
  const hasSeasonPicks = Boolean(profile.season?.picks?.length);
  const canShowSeasonPicks = includeHiddenPicks || seasonPicksVisible(round, profile.season?.score);
  const topTeams = canShowSeasonPicks ? seasonPickTeams(profile) : [];
  const stats = {
    guildId,
    season,
    userId,
    displayName: memberLabel(userId),
    rank: rank.rank,
    overallPoints: rank.score,
    weeksPredicted: weekly.weeksPredicted,
    weeksScored: weekly.weeksScored,
    weeklyWins: weekly.weeklyWins,
    top3Sweeps: weekly.top3Sweeps,
    topTeams,
    seasonPicks: canShowSeasonPicks ? profile.season?.picks || [] : [],
    seasonPicksHidden: hasSeasonPicks && !canShowSeasonPicks,
    seasonScore: profile.season?.score == null ? null : Number(profile.season.score),
    seasonBreakdown: scoreBreakdownVisible(profile.season) ? projectSeasonScoreBreakdown(profile.season) : null,
    recentWeekly: recentWeekly(profile),
  };
  return {
    ...stats,
    showcaseUsername: formatShowcaseUsername(stats),
  };
}

export async function getPublicEwcLeaderboard({
  guildId,
  season = DEFAULT_EWC_PROFILE_SEASON,
  limit = 50,
  offset = 0,
  // Test seam: production callers use the default one-query batch loader.
  identityLoader = publicEwcProfileIdentitiesByDiscordUserIds,
}) {
  const rows = await leaderboardRows(guildId, season, limit, offset);
  const normalizedOffset = Math.max(0, Math.floor(Number(offset)) || 0);
  const topRows = normalizedOffset === 0 && rows.length ? rows : await leaderboardRows(guildId, season, 1, 0);
  const userIds = rows.map((row) => row.user_id);
  const weeklyByUser = await weeklyAggregateStatsForUsers(guildId, season, userIds);
  const topTeamsByUser = await seasonPickTeamsForUsers(guildId, season, userIds);
  // One bounded identity lookup for this page. The map is internal-only and is
  // discarded while projecting rows, so a Discord ID never crosses the public
  // response boundary.
  const identitiesByUser = await identityLoader(userIds);
  const projectedNames = rows.map((row) => identitiesByUser.get(row.user_id)?.displayName || memberLabel(row.user_id));
  const nameCounts = new Map();
  for (const name of projectedNames) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  const seenNames = new Map();
  return {
    guildId,
    season,
    total: await countOverallScored(guildId, season),
    topScore: Number(topRows[0]?.score || 0),
    rows: rows.map((row, index) => {
      const userId = row.user_id;
      const weekly = weeklyByUser.get(userId) || emptyWeeklyAggregate();
      const identity = identitiesByUser.get(userId);
      const baseName = projectedNames[index];
      const seen = (seenNames.get(baseName) || 0) + 1;
      seenNames.set(baseName, seen);
      // A simple occurrence marker disambiguates coincident public names without
      // deriving or encoding any part of a Discord/account identifier.
      const displayName = nameCounts.get(baseName) > 1 ? `${baseName} (${seen})` : baseName;
      return {
        rank: Number(row.rank),
        displayName,
        avatarUrl: identity?.avatarToken ? `/api/ewc/public-avatar/${identity.avatarToken}` : null,
        overallPoints: Number(row.score || 0),
        weeksPredicted: weekly.weeksPredicted,
        weeksScored: weekly.weeksScored,
        weeklyWins: weekly.weeklyWins,
        top3Sweeps: weekly.top3Sweeps,
        topTeams: topTeamsByUser.get(userId) || [],
      };
    }),
  };
}

export function buildDiscordRoleConnectionPayload(stats) {
  const weeksPredicted = stats.weeksPredicted ?? stats.weeksScored ?? 0;
  return {
    platform_name: 'EWC Predictions',
    platform_username: stats.showcaseUsername || formatShowcaseUsername(stats),
    metadata: {
      overall_rank: String(stats.rank || UNRANKED_VALUE),
      overall_points: String(Math.max(0, Math.floor(Number(stats.overallPoints || 0)))),
      weeks_scored: String(Math.max(0, Math.floor(Number(weeksPredicted)))),
      weekly_wins: String(Math.max(0, Math.floor(Number(stats.weeklyWins || 0)))),
      top3_sweeps: String(Math.max(0, Math.floor(Number(stats.top3Sweeps || 0)))),
    },
  };
}

export async function getEwcRoleConnectionPayload(guildId, season, userId) {
  return buildDiscordRoleConnectionPayload(await getEwcUserProfileStats(guildId, season, userId));
}
