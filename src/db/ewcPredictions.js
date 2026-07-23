import { randomUUID } from 'node:crypto';

import { all, dbDriver, get, run, transaction } from './client.js';

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

async function getWith(client, sql, params) {
  return client ? client.get(sql, params) : get(sql, params);
}

async function allWith(client, sql, params) {
  return client ? client.all(sql, params) : all(sql, params);
}

function transactionWith(client) {
  return client ? async (fn) => fn(client) : transaction;
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

export async function getEwcWeek(guildId, season, weekKey, client = null) {
  return hydrateWeek(
    await getWith(client, 'SELECT * FROM ewc_prediction_weeks WHERE guild_id = $1 AND season = $2 AND week_key = $3', [
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

export async function listEwcWeeksForTimezoneReconciliation(season = '2026', { client = null, forUpdate = false } = {}) {
  const suffix = forUpdate && dbDriver() === 'postgres' ? ' FOR UPDATE' : '';
  return (
    await allWith(
      client,
      `SELECT * FROM ewc_prediction_weeks WHERE season = $1 ORDER BY id${suffix}`,
      [season],
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

// Weeks whose OPEN window has begun but whose "picks are open" announcement hasn't
// been posted yet: still open, open_at reached (or none), and close_at not yet
// passed. open_announced_at is stamped once so the automation never re-announces.
export async function listEwcWeeksToAnnounceOpen(nowSec) {
  return (
    await all(
      `SELECT *
       FROM ewc_prediction_weeks
       WHERE status = 'open'
         AND open_announced_at IS NULL
         AND (open_at IS NULL OR open_at <= $1)
         AND (close_at IS NULL OR close_at > $2)
       ORDER BY season, COALESCE(open_at, id), id`,
      [nowSec, nowSec],
    )
  ).map(hydrateWeek);
}

export async function markEwcWeekOpenAnnounced(weekId, client = null) {
  await runWith(client, 'UPDATE ewc_prediction_weeks SET open_announced_at = $1 WHERE id = $2', [nowText(), weekId]);
}

export async function listOpenEwcWeeksForReminders() {
  return (
    await all(
      `SELECT *
       FROM ewc_prediction_weeks
       WHERE status = 'open' AND games_json IS NOT NULL
       ORDER BY season, COALESCE(open_at, id), id`,
    )
  ).map(hydrateWeek);
}

function reminderParams({ guildId, weekId, gameKey, kind }) {
  return [guildId, weekId, gameKey, kind];
}

export async function claimEwcPredictionReminder({ guildId, weekId, gameKey, kind, nowSec, leaseSeconds = 300 }) {
  const claimedAt = Math.floor(Number(nowSec));
  if (!Number.isSafeInteger(claimedAt)) throw new Error('A valid reminder claim time is required.');
  const token = randomUUID();
  return transaction(async (client) => {
    await client.run(
      `INSERT INTO ewc_prediction_reminders
         (guild_id, week_id, game_key, kind, claim_token, claim_expires_at, attempts)
       VALUES ($1, $2, $3, $4, NULL, NULL, 0)
       ON CONFLICT (guild_id, week_id, game_key, kind) DO NOTHING`,
      reminderParams({ guildId, weekId, gameKey, kind }),
    );
    const result = await client.run(
      `UPDATE ewc_prediction_reminders
       SET claim_token = $1, claim_expires_at = $2, attempts = attempts + 1
       WHERE guild_id = $3 AND week_id = $4 AND game_key = $5 AND kind = $6
         AND sent_at IS NULL
         AND (claim_expires_at IS NULL OR claim_expires_at <= $7)`,
      [token, claimedAt + Math.max(1, Math.floor(Number(leaseSeconds)) || 300), ...reminderParams({ guildId, weekId, gameKey, kind }), claimedAt],
    );
    return changes(result) ? token : null;
  });
}

export async function markEwcPredictionReminderSent({ guildId, weekId, gameKey, kind, claimToken }) {
  const result = await run(
    `UPDATE ewc_prediction_reminders
     SET sent_at = $1, claim_token = NULL, claim_expires_at = NULL
     WHERE guild_id = $2 AND week_id = $3 AND game_key = $4 AND kind = $5
       AND sent_at IS NULL AND claim_token = $6`,
    [nowText(), ...reminderParams({ guildId, weekId, gameKey, kind }), claimToken],
  );
  return Boolean(changes(result));
}

export async function releaseEwcPredictionReminderClaim({ guildId, weekId, gameKey, kind, claimToken }) {
  const result = await run(
    `UPDATE ewc_prediction_reminders
     SET claim_token = NULL, claim_expires_at = NULL
     WHERE guild_id = $1 AND week_id = $2 AND game_key = $3 AND kind = $4
       AND sent_at IS NULL AND claim_token = $5`,
    [...reminderParams({ guildId, weekId, gameKey, kind }), claimToken],
  );
  return Boolean(changes(result));
}

export async function getEwcPredictionReminder({ guildId, weekId, gameKey, kind }) {
  return get(
    `SELECT * FROM ewc_prediction_reminders
     WHERE guild_id = $1 AND week_id = $2 AND game_key = $3 AND kind = $4`,
    reminderParams({ guildId, weekId, gameKey, kind }),
  );
}

export async function listEwcPredictionRemindersForWeek(weekId) {
  return all(
    `SELECT game_key, kind, sent_at, claim_expires_at, attempts
     FROM ewc_prediction_reminders
     WHERE week_id = $1
     ORDER BY game_key, kind`,
    [weekId],
  );
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

export async function reopenEwcWeek(weekId, client = null) {
  await runWith(
    client,
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

export async function setEwcWeekResults(weekId, results, client = null) {
  await runWith(client, 'UPDATE ewc_prediction_weeks SET results_json = $1 WHERE id = $2', [stringify(results), weekId]);
}

export async function upsertWeeklyPrediction({ guildId, weekId, userId, picks, client = null }) {
  const now = nowText();
  await runWith(
    client,
    `INSERT INTO ewc_weekly_predictions (guild_id, week_id, user_id, picks_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (guild_id, week_id, user_id) DO UPDATE SET
       picks_json = excluded.picks_json,
       score = NULL,
       details_json = NULL,
       updated_at = excluded.updated_at`,
    [guildId, weekId, userId, stringify(picks), now],
  );
  return getWeeklyPrediction(guildId, weekId, userId, client);
}

async function lockWeeklyPrediction(client, { guildId, weekId, userId }) {
  const now = nowText();
  await client.run(
    `INSERT INTO ewc_weekly_predictions (guild_id, week_id, user_id, picks_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (guild_id, week_id, user_id) DO NOTHING`,
    [guildId, weekId, userId, stringify([]), now],
  );
  const suffix = dbDriver() === 'postgres' ? ' FOR UPDATE' : '';
  return hydratePrediction(
    await client.get(
      `SELECT * FROM ewc_weekly_predictions WHERE guild_id = $1 AND week_id = $2 AND user_id = $3${suffix}`,
      [guildId, weekId, userId],
    ),
  );
}

export async function upsertWeeklyGamePick({
  guildId,
  weekId,
  userId,
  gameKey,
  pick,
  game = null,
  event = null,
  pickedAt = Math.floor(Date.now() / 1000),
  client = null,
}) {
  return transactionWith(client)(async (runner) => {
    const existing = await lockWeeklyPrediction(runner, { guildId, weekId, userId });
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
      pickedAt: Math.floor(Number(pickedAt)),
    });
    next.sort((a, b) => String(a.game || a.gameKey).localeCompare(String(b.game || b.gameKey)));
    const now = nowText();
    await runner.run(
      `UPDATE ewc_weekly_predictions
       SET picks_json = $1, score = NULL, details_json = NULL, updated_at = $2
       WHERE guild_id = $3 AND week_id = $4 AND user_id = $5`,
      [stringify(next), now, guildId, weekId, userId],
    );
    const saved = await getWeeklyPrediction(guildId, weekId, userId, runner);
    // `firstPick` = the member had NO picks for this week before now. Callers use it
    // to publicly announce participation exactly once per member per week.
    return { ...saved, firstPick: current.length === 0 };
  });
}

export async function getWeeklyPrediction(guildId, weekId, userId, client = null) {
  return hydratePrediction(
    await getWith(client, 'SELECT * FROM ewc_weekly_predictions WHERE guild_id = $1 AND week_id = $2 AND user_id = $3', [
      guildId,
      weekId,
      userId,
    ]),
  );
}

export async function listWeeklyPredictions(weekId, client = null, { forUpdate = false } = {}) {
  const suffix = forUpdate && dbDriver() === 'postgres' ? ' FOR UPDATE' : '';
  return (await allWith(client, `SELECT * FROM ewc_weekly_predictions WHERE week_id = $1${suffix}`, [weekId])).map(hydratePrediction);
}

export async function updateEwcWeekTimingForTimezoneReconciliation(
  { weekId, startAt, endAt, openAt, closeAt, scoreAfter, games },
  client = null,
) {
  const result = await runWith(
    client,
    `UPDATE ewc_prediction_weeks
     SET start_at = $1,
         end_at = $2,
         open_at = $3,
         close_at = $4,
         score_after = $5,
         games_json = $6
     WHERE id = $7
       AND season = '2026'
       AND status != 'scored'
       AND scored_at IS NULL`,
    [startAt, endAt, openAt, closeAt, scoreAfter, stringify(games), weekId],
  );
  return changes(result);
}

function emptyWeeklyPickDistribution() {
  return { locked: false, totalPicks: 0, games: [] };
}

function weeklyPickDistributionAvailable(week, nowSec) {
  if (!week) return false;
  if (week.status === 'closed' || week.status === 'scored') return true;
  const closeAt = Number(week.close_at);
  return week.close_at != null && Number.isFinite(closeAt) && nowSec >= closeAt;
}

// Aggregate output intentionally has no member identifiers. Keeping the lock check
// here protects every future web/API caller, rather than relying on a UI boundary.
export async function getWeeklyPickDistribution(guildId, weekId, nowSec = Math.floor(Date.now() / 1000)) {
  const week = hydrateWeek(
    await get('SELECT * FROM ewc_prediction_weeks WHERE guild_id = $1 AND id = $2', [guildId, weekId]),
  );
  const now = Math.floor(Number(nowSec));
  if (!weeklyPickDistributionAvailable(week, Number.isFinite(now) ? now : Math.floor(Date.now() / 1000))) {
    return emptyWeeklyPickDistribution();
  }

  const games = new Map(
    (Array.isArray(week.games) ? week.games : [])
      .filter((game) => game?.key)
      .map((game) => [
        String(game.key),
        {
          gameKey: String(game.key),
          game: game.game || String(game.key),
          event: game.event || null,
          totalPicks: 0,
          picks: new Map(),
        },
      ]),
  );
  const rows = await all('SELECT picks_json FROM ewc_weekly_predictions WHERE guild_id = $1 AND week_id = $2', [
    guildId,
    weekId,
  ]);

  for (const row of rows) {
    const picks = parseJson(row.picks_json, []);
    if (!Array.isArray(picks)) continue;
    for (const entry of picks) {
      if (!entry || typeof entry !== 'object') continue;
      const gameKey = String(entry.gameKey || '');
      const pick = String(entry.pick || '').replace(/\s+/g, ' ').trim();
      const game = games.get(gameKey);
      if (!game || !pick) continue;
      game.totalPicks += 1;
      game.picks.set(pick, (game.picks.get(pick) || 0) + 1);
    }
  }

  const distributionGames = [...games.values()].map((game) => ({
    gameKey: game.gameKey,
    game: game.game,
    event: game.event,
    totalPicks: game.totalPicks,
    picks: [...game.picks.entries()]
      .map(([pick, count]) => ({
        pick,
        count,
        percentage: game.totalPicks ? Math.round((count / game.totalPicks) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.pick.localeCompare(b.pick)),
  }));

  return {
    locked: true,
    totalPicks: distributionGames.reduce((sum, game) => sum + game.totalPicks, 0),
    games: distributionGames,
  };
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

export async function clearWeeklyPredictionScores(weekId, client = null) {
  return runWith(client, 'UPDATE ewc_weekly_predictions SET score = NULL, details_json = NULL WHERE week_id = $1', [weekId]);
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
      `WITH ranked AS (
         SELECT *, RANK() OVER (ORDER BY score DESC) AS rank
         FROM ewc_weekly_predictions
         WHERE week_id = $1 AND score IS NOT NULL
       )
       SELECT * FROM ranked
       ORDER BY score DESC, updated_at ASC, user_id ASC
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

export async function getEwcSeason(guildId, season = '2026', client = null) {
  return hydrateSeason(await getWith(client, 'SELECT * FROM ewc_prediction_seasons WHERE guild_id = $1 AND season = $2', [guildId, season]));
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

export async function reopenEwcSeason(guildId, season, client = null) {
  await runWith(
    client,
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

async function lockSeasonPrediction(client, { guildId, season, userId }) {
  const now = nowText();
  await client.run(
    `INSERT INTO ewc_season_predictions (guild_id, season, user_id, picks_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (guild_id, season, user_id) DO NOTHING`,
    [guildId, season, userId, stringify([]), now],
  );
  const suffix = dbDriver() === 'postgres' ? ' FOR UPDATE' : '';
  return hydratePrediction(
    await client.get(
      `SELECT * FROM ewc_season_predictions WHERE guild_id = $1 AND season = $2 AND user_id = $3${suffix}`,
      [guildId, season, userId],
    ),
  );
}

async function saveLockedSeasonPrediction(client, { guildId, season, userId, picks }) {
  await client.run(
    `UPDATE ewc_season_predictions
     SET picks_json = $1, score = NULL, details_json = NULL, updated_at = $2
     WHERE guild_id = $3 AND season = $4 AND user_id = $5`,
    [stringify(picks), nowText(), guildId, season, userId],
  );
  return getSeasonPrediction(guildId, season, userId, client);
}

export async function upsertSeasonPrediction({ guildId, season = '2026', userId, picks, client = null }) {
  return transactionWith(client)(async (runner) => {
    const existing = await lockSeasonPrediction(runner, { guildId, season, userId });
    const saved = await saveLockedSeasonPrediction(runner, { guildId, season, userId, picks });
    return { ...saved, firstPick: (existing?.picks || []).length === 0 };
  });
}

// Set ONE ordered slot (0-based) of a member's season picks, preserving the others.
// Mirrors upsertWeeklyGamePick's incremental model. Pads with nulls; callers trim.
export async function upsertSeasonClubPick({ guildId, season = '2026', userId, index, pick, client = null }) {
  return transactionWith(client)(async (runner) => {
    const existing = await lockSeasonPrediction(runner, { guildId, season, userId });
    const current = Array.isArray(existing?.picks) ? existing.picks : [];
    const picks = [...current];
    while (picks.length <= index) picks.push(null);
    picks[index] = pick;
    const cleaned = picks.filter((value) => typeof value === 'string' && value.trim());
    const saved = await saveLockedSeasonPrediction(runner, { guildId, season, userId, picks: cleaned });
    return { ...saved, firstPick: current.length === 0 };
  });
}

// Swap two already-set ranks of a member's season picks in one step (reorder, no gaps).
// Both indices must hold a pick — callers enforce that; a no-op if either is out of range.
export async function swapSeasonClubPicks({ guildId, season = '2026', userId, a, b, client = null }) {
  return transactionWith(client)(async (runner) => {
    const existing = await lockSeasonPrediction(runner, { guildId, season, userId });
    const picks = Array.isArray(existing?.picks) ? [...existing.picks] : [];
    if (a === b || a < 0 || b < 0 || a >= picks.length || b >= picks.length) return existing;
    [picks[a], picks[b]] = [picks[b], picks[a]];
    return saveLockedSeasonPrediction(runner, { guildId, season, userId, picks });
  });
}

export async function getSeasonPrediction(guildId, season, userId, client = null) {
  return hydratePrediction(
    await getWith(client, 'SELECT * FROM ewc_season_predictions WHERE guild_id = $1 AND season = $2 AND user_id = $3', [
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

export async function clearSeasonPredictionScores(guildId, season = '2026', client = null) {
  return runWith(client, 'UPDATE ewc_season_predictions SET score = NULL, details_json = NULL WHERE guild_id = $1 AND season = $2', [
    guildId,
    season,
  ]);
}

export async function seasonLeaderboard(guildId, season = '2026', limit = 20, offset = 0) {
  return (
    await all(
      `WITH ranked AS (
         SELECT *, RANK() OVER (ORDER BY score DESC) AS rank
         FROM ewc_season_predictions
         WHERE guild_id = $1 AND season = $2 AND score IS NOT NULL
       )
       SELECT * FROM ranked
       ORDER BY score DESC, updated_at ASC, user_id ASC
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
// Keep this CTE shared by the list and profile-rank queries so both use the same
// best-N and competition-ranking semantics.
const overallRankedCte = `WITH ranked_weekly AS (
       SELECT wp.user_id, wp.score,
              ROW_NUMBER() OVER (PARTITION BY wp.user_id ORDER BY wp.score DESC, wp.week_id) AS rn
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       WHERE wp.guild_id = $1 AND w.season = $2 AND wp.score IS NOT NULL
     ),
     scores AS (
       SELECT user_id, score FROM ranked_weekly WHERE rn <= $3
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
     ranked_totals AS (
       SELECT user_id, score, RANK() OVER (ORDER BY score DESC) AS rank
       FROM totals
     )`;

export async function overallLeaderboard(guildId, season = '2026', limit = 20, offset = 0) {
  const k = await overallBestWeekCount(guildId, season);
  return all(
    `${overallRankedCte}
     SELECT user_id, score, rank
     FROM ranked_totals
     ORDER BY score DESC, user_id ASC
     LIMIT $6 OFFSET $7`,
    [guildId, season, k, guildId, season, limit, offset],
  );
}

// Member-scoped consumers (such as private mini-leagues) must use the exact
// official overall-score projection above, not reimplement its best-week rule.
export async function overallLeaderboardForUsers(guildId, season = '2026', userIds = []) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).filter((id) => typeof id === 'string' && id))].slice(0, 100);
  if (!ids.length) return [];
  const k = await overallBestWeekCount(guildId, season);
  const placeholders = ids.map((_id, index) => `$${index + 6}`).join(', ');
  return all(
    `${overallRankedCte}
     SELECT user_id, score, rank
     FROM ranked_totals
     WHERE user_id IN (${placeholders})
     ORDER BY score DESC, user_id ASC`,
    [guildId, season, k, guildId, season, ...ids],
  );
}

export async function overallRankForUser(guildId, season = '2026', userId) {
  const k = await overallBestWeekCount(guildId, season);
  return get(
    `${overallRankedCte}
     SELECT rank, score
     FROM ranked_totals
     WHERE user_id = $6`,
    [guildId, season, k, guildId, season, userId],
  );
}

// Keep comparison data aggregate-only: callers receive their own competition
// rank and the participant count, never the other leaderboard rows.
export async function overallComparisonForUser(guildId, season = '2026', userId) {
  const k = await overallBestWeekCount(guildId, season);
  return get(
    `${overallRankedCte}
     SELECT COUNT(*) AS total,
            MAX(CASE WHEN user_id = $6 THEN rank END) AS rank,
            MAX(CASE WHEN user_id = $6 THEN score END) AS score
     FROM ranked_totals`,
    [guildId, season, k, guildId, season, userId],
  );
}

export async function latestScoredWeeklyComparisonForUser(guildId, season = '2026', userId) {
  return get(
    `WITH latest_week AS (
       SELECT id, week_key, label
       FROM ewc_prediction_weeks
       WHERE guild_id = $1 AND season = $2 AND status = 'scored'
       ORDER BY scored_at DESC, id DESC
       LIMIT 1
     ),
     ranked AS (
       SELECT wp.user_id, wp.score, RANK() OVER (ORDER BY wp.score DESC) AS rank
       FROM ewc_weekly_predictions wp
       JOIN latest_week w ON w.id = wp.week_id
       WHERE wp.guild_id = $1 AND wp.score IS NOT NULL
     )
     SELECT w.week_key,
            w.label,
            (SELECT COUNT(*) FROM ranked) AS total,
            (SELECT rank FROM ranked WHERE user_id = $3) AS rank
     FROM latest_week w`,
    [guildId, season, userId],
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
