import { db } from './index.js';

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const stringify = (value) => JSON.stringify(value ?? null);

function hydrateWeek(row) {
  if (!row) return null;
  return {
    ...row,
    baseline: parseJson(row.baseline_json, []),
    final: parseJson(row.final_json, []),
  };
}

function hydratePrediction(row) {
  if (!row) return null;
  return {
    ...row,
    picks: parseJson(row.picks_json, []),
    details: parseJson(row.details_json, null),
  };
}

export function upsertEwcWeek({ guildId, season = '2026', weekKey, label, openAt, closeAt, scoreAfter, createdBy }) {
  db.prepare(
    `INSERT INTO ewc_prediction_weeks
       (guild_id, season, week_key, label, open_at, close_at, score_after, created_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))
     ON CONFLICT (guild_id, season, week_key) DO UPDATE SET
       label = excluded.label,
       open_at = excluded.open_at,
       close_at = excluded.close_at,
       score_after = excluded.score_after,
       status = CASE WHEN ewc_prediction_weeks.status = 'scored' THEN 'scored' ELSE 'open' END`,
  ).run(guildId, season, weekKey, label, openAt ?? null, closeAt ?? null, scoreAfter ?? null, createdBy ?? null);
  return getEwcWeek(guildId, season, weekKey);
}

export function getEwcWeek(guildId, season, weekKey) {
  return hydrateWeek(
    db
      .prepare('SELECT * FROM ewc_prediction_weeks WHERE guild_id = ? AND season = ? AND week_key = ?')
      .get(guildId, season, weekKey),
  );
}

export function listEwcWeeks(guildId, season = '2026') {
  return db
    .prepare('SELECT * FROM ewc_prediction_weeks WHERE guild_id = ? AND season = ? ORDER BY COALESCE(open_at, id), id')
    .all(guildId, season)
    .map(hydrateWeek);
}

export function listEwcWeeksForAutomation(nowSec) {
  return db
    .prepare(
      `SELECT *
       FROM ewc_prediction_weeks
       WHERE status != 'scored'
         AND (
           (baseline_json IS NULL AND COALESCE(close_at, open_at) IS NOT NULL AND COALESCE(close_at, open_at) <= ?)
           OR (close_at IS NOT NULL AND close_at <= ?)
         )
       ORDER BY season, COALESCE(close_at, open_at, id), id`,
    )
    .all(nowSec, nowSec)
    .map(hydrateWeek);
}

export function setEwcWeekStatus(weekId, status) {
  db.prepare(
    `UPDATE ewc_prediction_weeks
     SET status = ?, scored_at = CASE WHEN ? = 'scored' THEN scored_at ELSE NULL END
     WHERE id = ?`,
  ).run(status, status, weekId);
}

export function reopenEwcWeek(weekId) {
  db.prepare(
    `UPDATE ewc_prediction_weeks
     SET status = 'open', final_json = NULL, scored_at = NULL
     WHERE id = ?`,
  ).run(weekId);
}

export function setEwcWeekSnapshot(weekId, type, standings) {
  const column = type === 'baseline' ? 'baseline_json' : 'final_json';
  db.prepare(`UPDATE ewc_prediction_weeks SET ${column} = ? WHERE id = ?`).run(stringify(standings), weekId);
}

export function markEwcWeekScored(weekId, finalStandings) {
  db.prepare(
    `UPDATE ewc_prediction_weeks
     SET status = 'scored', final_json = ?, scored_at = datetime('now')
     WHERE id = ?`,
  ).run(stringify(finalStandings), weekId);
}

export function upsertWeeklyPrediction({ guildId, weekId, userId, picks }) {
  db.prepare(
    `INSERT INTO ewc_weekly_predictions (guild_id, week_id, user_id, picks_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (guild_id, week_id, user_id) DO UPDATE SET
       picks_json = excluded.picks_json,
       score = NULL,
       details_json = NULL,
       updated_at = datetime('now')`,
  ).run(guildId, weekId, userId, stringify(picks));
  return getWeeklyPrediction(guildId, weekId, userId);
}

export function getWeeklyPrediction(guildId, weekId, userId) {
  return hydratePrediction(
    db
      .prepare('SELECT * FROM ewc_weekly_predictions WHERE guild_id = ? AND week_id = ? AND user_id = ?')
      .get(guildId, weekId, userId),
  );
}

export function listWeeklyPredictions(weekId) {
  return db.prepare('SELECT * FROM ewc_weekly_predictions WHERE week_id = ?').all(weekId).map(hydratePrediction);
}

export function saveWeeklyPredictionScore(guildId, weekId, userId, score, details) {
  db.prepare(
    `UPDATE ewc_weekly_predictions
     SET score = ?, details_json = ?, updated_at = datetime('now')
     WHERE guild_id = ? AND week_id = ? AND user_id = ?`,
  ).run(score, stringify(details), guildId, weekId, userId);
}

export function clearWeeklyPredictionScores(weekId) {
  return db.prepare('UPDATE ewc_weekly_predictions SET score = NULL, details_json = NULL WHERE week_id = ?').run(weekId);
}

export function deleteEwcWeek(weekId) {
  // FK cascade is enabled, but explicit child deletes let callers report the
  // deleted prediction count while keeping the operation atomic.
  const run = db.transaction((id) => {
    const predictions = db
      .prepare(`DELETE FROM ewc_weekly_predictions WHERE week_id = ?`)
      .run(id).changes;
    const weeks = db
      .prepare(`DELETE FROM ewc_prediction_weeks WHERE id = ?`)
      .run(id).changes;
    return { weeks, predictions };
  });
  return run(weekId);
}

export function weeklyLeaderboard(weekId, limit = 20, offset = 0) {
  return db
    .prepare(
      `SELECT * FROM ewc_weekly_predictions
       WHERE week_id = ? AND score IS NOT NULL
       ORDER BY score DESC, updated_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(weekId, limit, offset)
    .map(hydratePrediction);
}

export function upsertEwcSeason({
  guildId,
  season = '2026',
  label,
  openAt,
  closeAt,
  scoreAfter,
  topSize = 10,
  bestWeeks,
  createdBy,
}) {
  db.prepare(
    `INSERT INTO ewc_prediction_seasons
       (guild_id, season, label, open_at, close_at, score_after, top_size, best_weeks, created_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))
     ON CONFLICT (guild_id, season) DO UPDATE SET
       label = excluded.label,
       open_at = excluded.open_at,
       close_at = excluded.close_at,
       score_after = excluded.score_after,
       top_size = excluded.top_size,
       best_weeks = excluded.best_weeks,
       status = CASE WHEN ewc_prediction_seasons.status = 'scored' THEN 'scored' ELSE 'open' END`,
  ).run(guildId, season, label, openAt ?? null, closeAt ?? null, scoreAfter ?? null, topSize, bestWeeks ?? null, createdBy ?? null);
  return getEwcSeason(guildId, season);
}

export function getEwcSeason(guildId, season = '2026') {
  const row = db.prepare('SELECT * FROM ewc_prediction_seasons WHERE guild_id = ? AND season = ?').get(guildId, season);
  if (!row) return null;
  return { ...row, final: parseJson(row.final_json, []) };
}

export function listEwcSeasonsForAutomation(nowSec) {
  return db
    .prepare(
      `SELECT *
       FROM ewc_prediction_seasons
       WHERE status != 'scored'
         AND close_at IS NOT NULL
         AND close_at <= ?
       ORDER BY season`,
    )
    .all(nowSec)
    .map((row) => ({ ...row, final: parseJson(row.final_json, []) }));
}

export function setEwcSeasonStatus(guildId, season, status) {
  db.prepare(
    `UPDATE ewc_prediction_seasons
     SET status = ?, scored_at = CASE WHEN ? = 'scored' THEN scored_at ELSE NULL END
     WHERE guild_id = ? AND season = ?`,
  ).run(
    status,
    status,
    guildId,
    season,
  );
}

export function reopenEwcSeason(guildId, season) {
  db.prepare(
    `UPDATE ewc_prediction_seasons
     SET status = 'open', final_json = NULL, scored_at = NULL
     WHERE guild_id = ? AND season = ?`,
  ).run(guildId, season);
}

export function markEwcSeasonScored(guildId, season, finalStandings) {
  db.prepare(
    `UPDATE ewc_prediction_seasons
     SET status = 'scored', final_json = ?, scored_at = datetime('now')
     WHERE guild_id = ? AND season = ?`,
  ).run(stringify(finalStandings), guildId, season);
}

export function upsertSeasonPrediction({ guildId, season = '2026', userId, picks }) {
  db.prepare(
    `INSERT INTO ewc_season_predictions (guild_id, season, user_id, picks_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (guild_id, season, user_id) DO UPDATE SET
       picks_json = excluded.picks_json,
       score = NULL,
       details_json = NULL,
       updated_at = datetime('now')`,
  ).run(guildId, season, userId, stringify(picks));
  return getSeasonPrediction(guildId, season, userId);
}

export function getSeasonPrediction(guildId, season, userId) {
  return hydratePrediction(
    db
      .prepare('SELECT * FROM ewc_season_predictions WHERE guild_id = ? AND season = ? AND user_id = ?')
      .get(guildId, season, userId),
  );
}

export function listSeasonPredictions(guildId, season = '2026') {
  return db
    .prepare('SELECT * FROM ewc_season_predictions WHERE guild_id = ? AND season = ?')
    .all(guildId, season)
    .map(hydratePrediction);
}

export function saveSeasonPredictionScore(guildId, season, userId, score, details) {
  db.prepare(
    `UPDATE ewc_season_predictions
     SET score = ?, details_json = ?, updated_at = datetime('now')
     WHERE guild_id = ? AND season = ? AND user_id = ?`,
  ).run(score, stringify(details), guildId, season, userId);
}

export function clearSeasonPredictionScores(guildId, season = '2026') {
  return db
    .prepare('UPDATE ewc_season_predictions SET score = NULL, details_json = NULL WHERE guild_id = ? AND season = ?')
    .run(guildId, season);
}

export function seasonLeaderboard(guildId, season = '2026', limit = 20, offset = 0) {
  return db
    .prepare(
      `SELECT * FROM ewc_season_predictions
       WHERE guild_id = ? AND season = ? AND score IS NOT NULL
       ORDER BY score DESC, updated_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(guildId, season, limit, offset)
    .map(hydratePrediction);
}

export function countWeeklyScored(weekId) {
  return db.prepare('SELECT COUNT(*) c FROM ewc_weekly_predictions WHERE week_id = ? AND score IS NOT NULL').get(weekId).c;
}

export function countSeasonScored(guildId, season = '2026') {
  return db
    .prepare('SELECT COUNT(*) c FROM ewc_season_predictions WHERE guild_id = ? AND season = ? AND score IS NOT NULL')
    .get(guildId, season).c;
}

export function countOverallScored(guildId, season = '2026') {
  return db
    .prepare(
      `SELECT COUNT(*) c FROM (
         SELECT user_id FROM ewc_weekly_predictions wp
           JOIN ewc_prediction_weeks w ON w.id = wp.week_id
           WHERE wp.guild_id = ? AND w.season = ? AND wp.score IS NOT NULL
         UNION
         SELECT user_id FROM ewc_season_predictions
           WHERE guild_id = ? AND season = ? AND score IS NOT NULL
       )`,
    )
    .get(guildId, season, guildId, season).c;
}

// Overall = each user's weekly scores + their season score. When the season has best_weeks set,
// only each user's top-N weekly scores count (fairer: neutralizes participation + week unevenness).
export function overallLeaderboard(guildId, season = '2026', limit = 20, offset = 0) {
  const s = db.prepare('SELECT best_weeks FROM ewc_prediction_seasons WHERE guild_id = ? AND season = ?').get(guildId, season);
  const k = s && s.best_weeks > 0 ? s.best_weeks : 999999; // null/0 means count every week
  return db
    .prepare(
      `WITH ranked AS (
         SELECT wp.user_id, wp.score,
                ROW_NUMBER() OVER (PARTITION BY wp.user_id ORDER BY wp.score DESC, wp.week_id) AS rn
         FROM ewc_weekly_predictions wp
         JOIN ewc_prediction_weeks w ON w.id = wp.week_id
         WHERE wp.guild_id = ? AND w.season = ? AND wp.score IS NOT NULL
       ),
       scores AS (
         SELECT user_id, score FROM ranked WHERE rn <= ?
         UNION ALL
         SELECT user_id, score
         FROM ewc_season_predictions
         WHERE guild_id = ? AND season = ? AND score IS NOT NULL
       )
       SELECT user_id, SUM(score) AS score
       FROM scores
       GROUP BY user_id
       ORDER BY score DESC, user_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(guildId, season, k, guildId, season, limit, offset);
}

export function overallRankForUser(guildId, season = '2026', userId) {
  const s = db.prepare('SELECT best_weeks FROM ewc_prediction_seasons WHERE guild_id = ? AND season = ?').get(guildId, season);
  const k = s && s.best_weeks > 0 ? s.best_weeks : 999999;
  return (
    db
      .prepare(
        `WITH ranked AS (
           SELECT wp.user_id, wp.score,
                  ROW_NUMBER() OVER (PARTITION BY wp.user_id ORDER BY wp.score DESC, wp.week_id) AS rn
           FROM ewc_weekly_predictions wp
           JOIN ewc_prediction_weeks w ON w.id = wp.week_id
           WHERE wp.guild_id = ? AND w.season = ? AND wp.score IS NOT NULL
         ),
         scores AS (
           SELECT user_id, score FROM ranked WHERE rn <= ?
           UNION ALL
           SELECT user_id, score
           FROM ewc_season_predictions
           WHERE guild_id = ? AND season = ? AND score IS NOT NULL
         ),
         totals AS (
           SELECT user_id, SUM(score) AS score
           FROM scores
           GROUP BY user_id
         ),
         ordered AS (
           SELECT user_id, score, ROW_NUMBER() OVER (ORDER BY score DESC, user_id ASC) AS rank
           FROM totals
         )
         SELECT rank, score
         FROM ordered
         WHERE user_id = ?`,
      )
      .get(guildId, season, k, guildId, season, userId) || null
  );
}

export function userPredictionProfile(guildId, season, userId) {
  const weeks = db
    .prepare(
      `SELECT w.week_key, w.label, w.status, p.*
       FROM ewc_prediction_weeks w
       LEFT JOIN ewc_weekly_predictions p
         ON p.week_id = w.id AND p.guild_id = w.guild_id AND p.user_id = ?
       WHERE w.guild_id = ? AND w.season = ?
       ORDER BY COALESCE(w.open_at, w.id), w.id`,
    )
    .all(userId, guildId, season)
    .map((row) => ({
      ...row,
      picks: parseJson(row.picks_json, []),
      details: parseJson(row.details_json, null),
    }));
  return {
    weekly: weeks,
    season: getSeasonPrediction(guildId, season, userId),
  };
}
