import { all, get, run, transaction } from './client.js';

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const stringify = (value) => JSON.stringify(value ?? null);

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function changes(result) {
  return result?.changes ?? result?.rowCount ?? 0;
}

function hydrateWeek(row) {
  if (!row) return null;
  return {
    ...row,
    baseline: parseJson(row.baseline_json, []),
    final: parseJson(row.final_json, []),
    games: parseJson(row.games_json, []),
    results: parseJson(row.results_json, []),
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

function hydrateSeason(row) {
  if (!row) return null;
  return { ...row, final: parseJson(row.final_json, []) };
}

async function runWith(client, sql, params) {
  return client ? client.run(sql, params) : run(sql, params);
}

export async function upsertEwcWeek({
  guildId,
  season = '2026',
  weekKey,
  label,
  startAt,
  endAt,
  openAt,
  closeAt,
  scoreAfter,
  games,
  createdBy,
}) {
  await run(
    `INSERT INTO ewc_prediction_weeks
       (guild_id, season, week_key, label, start_at, end_at, open_at, close_at, score_after, games_json, created_by, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', $12)
     ON CONFLICT (guild_id, season, week_key) DO UPDATE SET
       label = excluded.label,
       start_at = excluded.start_at,
       end_at = excluded.end_at,
       open_at = excluded.open_at,
       close_at = excluded.close_at,
       score_after = excluded.score_after,
       games_json = excluded.games_json,
       status = CASE WHEN ewc_prediction_weeks.status = 'scored' THEN 'scored' ELSE 'open' END`,
    [
      guildId,
      season,
      weekKey,
      label,
      startAt ?? null,
      endAt ?? null,
      openAt ?? null,
      closeAt ?? null,
      scoreAfter ?? null,
      games ? stringify(games) : null,
      createdBy ?? null,
      nowText(),
    ],
  );
  return getEwcWeek(guildId, season, weekKey);
}

export async function getEwcWeek(guildId, season, weekKey) {
  return hydrateWeek(
    await get('SELECT * FROM ewc_prediction_weeks WHERE guild_id = $1 AND season = $2 AND week_key = $3', [
      guildId,
      season,
      weekKey,
    ]),
  );
}

export async function listEwcWeeks(guildId, season = '2026') {
  return (
    await all(
      'SELECT * FROM ewc_prediction_weeks WHERE guild_id = $1 AND season = $2 ORDER BY COALESCE(open_at, id), id',
      [guildId, season],
    )
  ).map(hydrateWeek);
}

export async function listEwcWeeksForAutomation(nowSec) {
  return (
    await all(
      `SELECT *
       FROM ewc_prediction_weeks
       WHERE status != 'scored'
         AND (
           (baseline_json IS NULL AND COALESCE(close_at, open_at) IS NOT NULL AND COALESCE(close_at, open_at) <= $1)
           OR (close_at IS NOT NULL AND close_at <= $2)
         )
       ORDER BY season, COALESCE(close_at, open_at, id), id`,
      [nowSec, nowSec],
    )
  ).map(hydrateWeek);
}

export async function setEwcWeekStatus(weekId, status, client = null) {
  await runWith(
    client,
    `UPDATE ewc_prediction_weeks
     SET status = $1, scored_at = CASE WHEN $2 = 'scored' THEN scored_at ELSE NULL END
     WHERE id = $3`,
    [status, status, weekId],
  );
}

export async function reopenEwcWeek(weekId) {
  await run(
    `UPDATE ewc_prediction_weeks
     SET status = 'open', final_json = NULL, results_json = NULL, scored_at = NULL
     WHERE id = $1`,
    [weekId],
  );
}

export async function setEwcWeekSnapshot(weekId, type, standings) {
  const column = type === 'baseline' ? 'baseline_json' : 'final_json';
  await run(`UPDATE ewc_prediction_weeks SET ${column} = $1 WHERE id = $2`, [stringify(standings), weekId]);
}

export async function markEwcWeekScored(weekId, finalStandings, client = null) {
  await runWith(
    client,
    `UPDATE ewc_prediction_weeks
     SET status = 'scored', final_json = $1, scored_at = $2
     WHERE id = $3`,
    [stringify(finalStandings), nowText(), weekId],
  );
}

export async function markEwcWeekScoredWithResults(weekId, finalStandings, results, client = null) {
  await runWith(
    client,
    `UPDATE ewc_prediction_weeks
     SET status = 'scored', final_json = $1, results_json = $2, scored_at = $3
     WHERE id = $4`,
    [stringify(finalStandings), stringify(results), nowText(), weekId],
  );
}

export async function setEwcWeekResults(weekId, results) {
  await run('UPDATE ewc_prediction_weeks SET results_json = $1 WHERE id = $2', [stringify(results), weekId]);
}

export async function upsertWeeklyPrediction({ guildId, weekId, userId, picks }) {
  const now = nowText();
  await run(
    `INSERT INTO ewc_weekly_predictions (guild_id, week_id, user_id, picks_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (guild_id, week_id, user_id) DO UPDATE SET
       picks_json = excluded.picks_json,
       score = NULL,
       details_json = NULL,
       updated_at = excluded.updated_at`,
    [guildId, weekId, userId, stringify(picks), now],
  );
  return getWeeklyPrediction(guildId, weekId, userId);
}

export async function upsertWeeklyGamePick({ guildId, weekId, userId, gameKey, pick, game = null, event = null }) {
  const existing = await getWeeklyPrediction(guildId, weekId, userId);
  const current = Array.isArray(existing?.picks) ? existing.picks : [];
  const next = current.filter((entry) => {
    if (typeof entry === 'string') return false;
    return entry?.gameKey !== gameKey;
  });
  next.push({
    gameKey,
    game,
    event,
    pick,
    pickedAt: Math.floor(Date.now() / 1000),
  });
  next.sort((a, b) => String(a.game || a.gameKey).localeCompare(String(b.game || b.gameKey)));
  const result = await upsertWeeklyPrediction({ guildId, weekId, userId, picks: next });
  // `firstPick` = the member had NO picks for this week before now. Callers use it
  // to publicly announce participation exactly once per member per week.
  return { ...result, firstPick: current.length === 0 };
}

export async function getWeeklyPrediction(guildId, weekId, userId) {
  return hydratePrediction(
    await get('SELECT * FROM ewc_weekly_predictions WHERE guild_id = $1 AND week_id = $2 AND user_id = $3', [
      guildId,
      weekId,
      userId,
    ]),
  );
}

export async function listWeeklyPredictions(weekId) {
  return (await all('SELECT * FROM ewc_weekly_predictions WHERE week_id = $1', [weekId])).map(hydratePrediction);
}

export async function saveWeeklyPredictionScore(guildId, weekId, userId, score, details, client = null) {
  await runWith(
    client,
    `UPDATE ewc_weekly_predictions
     SET score = $1, details_json = $2, updated_at = $3
     WHERE guild_id = $4 AND week_id = $5 AND user_id = $6`,
    [score, stringify(details), nowText(), guildId, weekId, userId],
  );
}

export async function clearWeeklyPredictionScores(weekId) {
  return run('UPDATE ewc_weekly_predictions SET score = NULL, details_json = NULL WHERE week_id = $1', [weekId]);
}

export async function deleteEwcWeek(weekId, client = null) {
  const tx = client ? async (fn) => fn(client) : transaction;
  return tx(async (runner) => {
    const predictions = changes(await runner.run('DELETE FROM ewc_weekly_predictions WHERE week_id = $1', [weekId]));
    const weeks = changes(await runner.run('DELETE FROM ewc_prediction_weeks WHERE id = $1', [weekId]));
    return { weeks, predictions };
  });
}

export async function weeklyLeaderboard(weekId, limit = 20, offset = 0) {
  return (
    await all(
      `SELECT * FROM ewc_weekly_predictions
       WHERE week_id = $1 AND score IS NOT NULL
       ORDER BY score DESC, updated_at ASC
       LIMIT $2 OFFSET $3`,
      [weekId, limit, offset],
    )
  ).map(hydratePrediction);
}

export async function upsertEwcSeason({
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
  await run(
    `INSERT INTO ewc_prediction_seasons
       (guild_id, season, label, open_at, close_at, score_after, top_size, best_weeks, created_by, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10)
     ON CONFLICT (guild_id, season) DO UPDATE SET
       label = excluded.label,
       open_at = excluded.open_at,
       close_at = excluded.close_at,
       score_after = excluded.score_after,
       top_size = excluded.top_size,
       best_weeks = excluded.best_weeks,
       status = CASE WHEN ewc_prediction_seasons.status = 'scored' THEN 'scored' ELSE 'open' END`,
    [
      guildId,
      season,
      label,
      openAt ?? null,
      closeAt ?? null,
      scoreAfter ?? null,
      topSize,
      bestWeeks ?? null,
      createdBy ?? null,
      nowText(),
    ],
  );
  return getEwcSeason(guildId, season);
}

export async function getEwcSeason(guildId, season = '2026') {
  return hydrateSeason(await get('SELECT * FROM ewc_prediction_seasons WHERE guild_id = $1 AND season = $2', [guildId, season]));
}

export async function listEwcSeasonsForAutomation(nowSec) {
  return (
    await all(
      `SELECT *
       FROM ewc_prediction_seasons
       WHERE status != 'scored'
         AND close_at IS NOT NULL
         AND close_at <= $1
       ORDER BY season`,
      [nowSec],
    )
  ).map(hydrateSeason);
}

export async function setEwcSeasonStatus(guildId, season, status, client = null) {
  await runWith(
    client,
    `UPDATE ewc_prediction_seasons
     SET status = $1, scored_at = CASE WHEN $2 = 'scored' THEN scored_at ELSE NULL END
     WHERE guild_id = $3 AND season = $4`,
    [status, status, guildId, season],
  );
}

export async function reopenEwcSeason(guildId, season) {
  await run(
    `UPDATE ewc_prediction_seasons
     SET status = 'open', final_json = NULL, scored_at = NULL
     WHERE guild_id = $1 AND season = $2`,
    [guildId, season],
  );
}

export async function markEwcSeasonScored(guildId, season, finalStandings, client = null) {
  await runWith(
    client,
    `UPDATE ewc_prediction_seasons
     SET status = 'scored', final_json = $1, scored_at = $2
     WHERE guild_id = $3 AND season = $4`,
    [stringify(finalStandings), nowText(), guildId, season],
  );
}

export async function upsertSeasonPrediction({ guildId, season = '2026', userId, picks }) {
  // `firstPick` = the member had no season prediction before now (announce once).
  const firstPick = !(await getSeasonPrediction(guildId, season, userId));
  const now = nowText();
  await run(
    `INSERT INTO ewc_season_predictions (guild_id, season, user_id, picks_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (guild_id, season, user_id) DO UPDATE SET
       picks_json = excluded.picks_json,
       score = NULL,
       details_json = NULL,
       updated_at = excluded.updated_at`,
    [guildId, season, userId, stringify(picks), now],
  );
  const saved = await getSeasonPrediction(guildId, season, userId);
  return { ...saved, firstPick };
}

export async function getSeasonPrediction(guildId, season, userId) {
  return hydratePrediction(
    await get('SELECT * FROM ewc_season_predictions WHERE guild_id = $1 AND season = $2 AND user_id = $3', [
      guildId,
      season,
      userId,
    ]),
  );
}

export async function listSeasonPredictions(guildId, season = '2026') {
  return (
    await all('SELECT * FROM ewc_season_predictions WHERE guild_id = $1 AND season = $2', [guildId, season])
  ).map(hydratePrediction);
}

export async function saveSeasonPredictionScore(guildId, season, userId, score, details, client = null) {
  await runWith(
    client,
    `UPDATE ewc_season_predictions
     SET score = $1, details_json = $2, updated_at = $3
     WHERE guild_id = $4 AND season = $5 AND user_id = $6`,
    [score, stringify(details), nowText(), guildId, season, userId],
  );
}

export async function clearSeasonPredictionScores(guildId, season = '2026') {
  return run('UPDATE ewc_season_predictions SET score = NULL, details_json = NULL WHERE guild_id = $1 AND season = $2', [
    guildId,
    season,
  ]);
}

export async function seasonLeaderboard(guildId, season = '2026', limit = 20, offset = 0) {
  return (
    await all(
      `SELECT * FROM ewc_season_predictions
       WHERE guild_id = $1 AND season = $2 AND score IS NOT NULL
       ORDER BY score DESC, updated_at ASC
       LIMIT $3 OFFSET $4`,
      [guildId, season, limit, offset],
    )
  ).map(hydratePrediction);
}

export async function countWeeklyScored(weekId) {
  const row = await get('SELECT COUNT(*) c FROM ewc_weekly_predictions WHERE week_id = $1 AND score IS NOT NULL', [weekId]);
  return Number(row?.c || 0);
}

export async function countSeasonScored(guildId, season = '2026') {
  const row = await get(
    'SELECT COUNT(*) c FROM ewc_season_predictions WHERE guild_id = $1 AND season = $2 AND score IS NOT NULL',
    [guildId, season],
  );
  return Number(row?.c || 0);
}

export async function countOverallScored(guildId, season = '2026') {
  const row = await get(
    `SELECT COUNT(*) c FROM (
       SELECT user_id FROM ewc_weekly_predictions wp
         JOIN ewc_prediction_weeks w ON w.id = wp.week_id
         WHERE wp.guild_id = $1 AND w.season = $2 AND wp.score IS NOT NULL
       UNION
       SELECT user_id FROM ewc_season_predictions
         WHERE guild_id = $3 AND season = $4 AND score IS NOT NULL
     ) counted`,
    [guildId, season, guildId, season],
  );
  return Number(row?.c || 0);
}

async function overallBestWeekCount(guildId, season) {
  const row = await get('SELECT best_weeks FROM ewc_prediction_seasons WHERE guild_id = $1 AND season = $2', [
    guildId,
    season,
  ]);
  return row && row.best_weeks > 0 ? row.best_weeks : 999999;
}

// Overall = each user's weekly scores + their season score. When the season has best_weeks set,
// only each user's top-N weekly scores count (fairer: neutralizes participation + week unevenness).
export async function overallLeaderboard(guildId, season = '2026', limit = 20, offset = 0) {
  const k = await overallBestWeekCount(guildId, season);
  return all(
    `WITH ranked AS (
       SELECT wp.user_id, wp.score,
              ROW_NUMBER() OVER (PARTITION BY wp.user_id ORDER BY wp.score DESC, wp.week_id) AS rn
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       WHERE wp.guild_id = $1 AND w.season = $2 AND wp.score IS NOT NULL
     ),
     scores AS (
       SELECT user_id, score FROM ranked WHERE rn <= $3
       UNION ALL
       SELECT user_id, score
       FROM ewc_season_predictions
       WHERE guild_id = $4 AND season = $5 AND score IS NOT NULL
     )
     SELECT user_id, SUM(score) AS score
     FROM scores
     GROUP BY user_id
     ORDER BY score DESC, user_id ASC
     LIMIT $6 OFFSET $7`,
    [guildId, season, k, guildId, season, limit, offset],
  );
}

export async function overallRankForUser(guildId, season = '2026', userId) {
  const k = await overallBestWeekCount(guildId, season);
  return get(
    `WITH ranked AS (
       SELECT wp.user_id, wp.score,
              ROW_NUMBER() OVER (PARTITION BY wp.user_id ORDER BY wp.score DESC, wp.week_id) AS rn
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       WHERE wp.guild_id = $1 AND w.season = $2 AND wp.score IS NOT NULL
     ),
     scores AS (
       SELECT user_id, score FROM ranked WHERE rn <= $3
       UNION ALL
       SELECT user_id, score
       FROM ewc_season_predictions
       WHERE guild_id = $4 AND season = $5 AND score IS NOT NULL
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
     WHERE user_id = $6`,
    [guildId, season, k, guildId, season, userId],
  );
}

export async function userPredictionProfile(guildId, season, userId) {
  const weeks = (
    await all(
      `SELECT w.week_key, w.label, w.status, w.close_at, w.games_json, p.*
       FROM ewc_prediction_weeks w
       LEFT JOIN ewc_weekly_predictions p
         ON p.week_id = w.id AND p.guild_id = w.guild_id AND p.user_id = $1
       WHERE w.guild_id = $2 AND w.season = $3
       ORDER BY COALESCE(w.open_at, w.id), w.id`,
      [userId, guildId, season],
    )
  ).map((row) => ({
    ...row,
    picks: parseJson(row.picks_json, []),
    details: parseJson(row.details_json, null),
    games: parseJson(row.games_json, []),
  }));
  return {
    weekly: weeks,
    season: await getSeasonPrediction(guildId, season, userId),
  };
}
