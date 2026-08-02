// Prediction administration lives here instead of the Discord command so the
// slash command and durable bot job have one set of guards and scoring rules.
// It intentionally has no Discord imports: side effects are callbacks supplied
// by the runtime that owns a Discord client.
import {
  clearSeasonPredictionScores,
  clearWeeklyPredictionScores,
  deleteEwcWeek,
  getEwcSeason,
  getEwcWeek,
  lockEwcSeasonForTransition,
  lockEwcWeekForTransition,
  listSeasonPredictions,
  listWeeklyPredictions,
  markEwcSeasonScored,
  markEwcWeekScored,
  markEwcWeekScoredWithResults,
  reopenEwcSeason,
  reopenEwcWeek,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  setEwcWeekSnapshot,
  upsertEwcWeek,
} from '../db/ewcPredictions.js';
import { transaction } from '../db/client.js';
import { config } from '../config.js';
import { validateEwcPredictionAdminOperation } from './ewcPredictionOperationValidation.js';
import {
  dueEwcGamesForResults,
  EWC_PREDICTION_READINESS,
  evaluateEwcSeasonScoringReadiness,
  evaluateEwcWeekScoringReadiness,
  ewcPredictionScoreAfter,
  generateEwcWeekWindows,
  mergeEwcGameResults,
  scorePerGameWeeklyPrediction,
  scoreSeasonPrediction,
  scoreWeeklyPrediction,
} from './ewcPredictions.js';
import { fetchEwcClubStandings, fetchEwcEventSchedule, fetchEwcWeekGameResults } from '../services/liquipedia.js';

export { EWC_PREDICTION_ADMIN_OPERATIONS, validateEwcPredictionAdminOperation } from './ewcPredictionOperationValidation.js';

const RESULT_READINESS_REASONS = new Set([
  EWC_PREDICTION_READINESS.MISSING_RESULTS,
  EWC_PREDICTION_READINESS.UNTRUSTED_RESULT,
  EWC_PREDICTION_READINESS.INCOMPLETE_RESULT,
  EWC_PREDICTION_READINESS.STALE_RESULT,
]);

const READINESS_MESSAGES = Object.freeze({
  [EWC_PREDICTION_READINESS.NOT_OPEN]: 'the prediction round has not opened',
  [EWC_PREDICTION_READINESS.GAMES_UNLOCKED]: 'one or more game picks are still unlocked',
  [EWC_PREDICTION_READINESS.ROUND_NOT_CLOSED]: 'the prediction round is not closed',
  [EWC_PREDICTION_READINESS.SCORE_DELAY_PENDING]: 'the scoring delay has not elapsed',
  [EWC_PREDICTION_READINESS.MISSING_BASELINE]: 'the weekly baseline snapshot is missing',
  [EWC_PREDICTION_READINESS.MISSING_RESULTS]: 'official results are missing',
  [EWC_PREDICTION_READINESS.UNTRUSTED_RESULT]: 'an official result source has not been verified',
  [EWC_PREDICTION_READINESS.INCOMPLETE_RESULT]: 'official results are incomplete',
  [EWC_PREDICTION_READINESS.STALE_RESULT]: 'the stored result snapshot is older than the final scoring time',
});

// The readiness decision already carries WHEN the block clears and which game is
// missing. Saying only that it is blocked sends an admin hunting through logs, so
// surface the detail the check already computed.
function readinessDetail(decision) {
  const readyAt = Number(decision?.readyAt);
  if (Number.isFinite(readyAt) && readyAt > 0) return ` Ready <t:${Math.floor(readyAt)}:R> (<t:${Math.floor(readyAt)}:f>).`;
  const gameKey = decision?.gameKey;
  return gameKey ? ` Waiting on \`${gameKey}\`.` : '';
}

export class EwcPredictionNotReadyError extends Error {
  constructor(decision) {
    const reasonCode = decision?.reason || EWC_PREDICTION_READINESS.INCOMPLETE_RESULT;
    super(
      `Prediction scoring is not ready: ${READINESS_MESSAGES[reasonCode] || 'the round is incomplete'} (${reasonCode}).` +
        readinessDetail(decision),
    );
    this.name = 'EwcPredictionNotReadyError';
    this.code = 'EWC_PREDICTION_NOT_READY';
    this.reasonCode = reasonCode;
    this.readyAt = Number.isFinite(Number(decision?.readyAt)) ? Number(decision.readyAt) : null;
  }
}

function requireReady(decision) {
  if (!decision?.ready) throw new EwcPredictionNotReadyError(decision);
}

async function currentStandings(season, dependencies) {
  const data = await dependencies.fetchStandings(season);
  if (!data?.exists || !Array.isArray(data.standings) || !data.standings.length) {
    throw new Error(`No Club Championship standings are available for ${season} yet.`);
  }
  return data.standings;
}

function malformedDetails(prediction, operationError) {
  return { error: String(operationError?.message || 'Malformed prediction.'), picks: prediction.picks };
}

async function refresh(effects, guildId) {
  if (!effects.refreshLeaderboard) return false;
  return Boolean(await effects.refreshLeaderboard(guildId));
}

async function scoreWeek({ guildId, season, weekKey, dependencies, effects, allowAlreadyComplete }) {
  const round = await dependencies.getWeek(guildId, season, weekKey);
  if (!round) throw new Error(`Week \`${weekKey}\` does not exist.`);
  if (round.status === 'scored') {
    if (allowAlreadyComplete) return { round: round.week_key, alreadyCompleted: true, message: `${round.label || round.week_key} is already scored.` };
    throw new Error(`Week \`${weekKey}\` is already scored. Reopen it first if you need to re-score.`);
  }

  const perGame = Array.isArray(round.games) && round.games.length > 0;
  const now = dependencies.nowSec();
  const readyAt = ewcPredictionScoreAfter(round, config.ewcPredictions.scoreDelayHours);
  const preflight = evaluateEwcWeekScoringReadiness(round, {
    now,
    results: round.results || [],
    finalStandings: round.final || [],
    scoreAfter: readyAt,
  });
  if (!preflight.ready && !(perGame ? RESULT_READINESS_REASONS.has(preflight.reason) : preflight.reason === EWC_PREDICTION_READINESS.MISSING_RESULTS)) {
    requireReady(preflight);
  }

  // Network resolution completes before the scoring transaction. This keeps the
  // lock short and prevents a Liquipedia request from holding database state.
  let fetchedResults = [];
  if (perGame) {
    const candidates = dueEwcGamesForResults(round.games, round.results || [], now, undefined, readyAt);
    if (candidates.length) {
      const fetched = await dependencies.fetchWeekResults(candidates);
      const fetchedAt = dependencies.nowSec();
      fetchedResults = (Array.isArray(fetched) ? fetched : []).map((result) => ({ ...result, fetchedAt }));
    }
  }
  const final = perGame ? round.final || [] : round.final?.length ? round.final : await currentStandings(season, dependencies);

  const scored = await dependencies.transaction(async (tx) => {
    const lockedRound = await dependencies.lockWeekForTransition(guildId, season, weekKey, tx);
    if (!lockedRound) throw new Error(`Week \`${weekKey}\` does not exist.`);
    if (lockedRound.status === 'scored') return { alreadyCompleted: true, round: lockedRound };
    if (JSON.stringify(lockedRound.games || []) !== JSON.stringify(round.games || [])) {
      throw new Error(`Week \`${weekKey}\` changed while scoring. Retry the operation.`);
    }
    const lockedPerGame = Array.isArray(lockedRound.games) && lockedRound.games.length > 0;
    const lockedResults = lockedPerGame ? mergeEwcGameResults(lockedRound.results || [], fetchedResults) : [];
    const lockedFinal = lockedPerGame ? lockedRound.final || [] : lockedRound.final?.length ? lockedRound.final : final;
    requireReady(evaluateEwcWeekScoringReadiness(lockedRound, {
      now: dependencies.nowSec(),
      results: lockedResults,
      finalStandings: lockedFinal,
      scoreAfter: ewcPredictionScoreAfter(lockedRound, config.ewcPredictions.scoreDelayHours),
    }));
    const predictions = await dependencies.listWeeklyPredictions(lockedRound.id, tx, { forUpdate: true });
    let malformed = 0;
    for (const prediction of predictions) {
      try {
        const score = lockedPerGame
          ? scorePerGameWeeklyPrediction(prediction.picks, lockedRound.games, lockedResults)
          : scoreWeeklyPrediction(prediction.picks, lockedRound.baseline, lockedFinal);
        await dependencies.saveWeeklyScore(guildId, lockedRound.id, prediction.user_id, score.score, score.details, tx);
      } catch (operationError) {
        malformed += 1;
        await dependencies.saveWeeklyScore(guildId, lockedRound.id, prediction.user_id, 0, malformedDetails(prediction, operationError), tx);
      }
    }
    if (lockedPerGame) await dependencies.markWeekScoredWithResults(lockedRound.id, lockedFinal || [], lockedResults, tx);
    else await dependencies.markWeekScored(lockedRound.id, lockedFinal, tx);
    return { round: lockedRound, predictions, malformed, perGame: lockedPerGame };
  });
  if (scored.alreadyCompleted) {
    if (allowAlreadyComplete) return { round: scored.round.week_key, alreadyCompleted: true, message: `${scored.round.label || scored.round.week_key} is already scored.` };
    throw new Error(`Week \`${weekKey}\` is already scored. Reopen it first if you need to re-score.`);
  }
  await refresh(effects, guildId);
  return {
    round: scored.round.week_key,
    predictions: scored.predictions.length,
    malformed: scored.malformed,
    mode: scored.perGame ? 'per-game' : 'aggregate',
    message: `Scored ${scored.round.label || scored.round.week_key} for ${scored.predictions.length} prediction(s).`,
  };
}

async function scoreSeason({ guildId, season, dependencies, effects, allowAlreadyComplete }) {
  const round = await dependencies.getSeason(guildId, season);
  if (!round) throw new Error(`No season round exists for ${season}.`);
  if (round.status === 'scored') {
    if (allowAlreadyComplete) return { season, alreadyCompleted: true, message: `EWC ${season} season predictions are already scored.` };
    throw new Error(`EWC ${season} season predictions are already scored. Reopen them first if you need to re-score.`);
  }
  const preflight = evaluateEwcSeasonScoringReadiness(round, round.final || [], {
    now: dependencies.nowSec(),
    scoreAfter: ewcPredictionScoreAfter(round, config.ewcPredictions.scoreDelayHours),
  });
  if (!preflight.ready && preflight.reason !== EWC_PREDICTION_READINESS.MISSING_RESULTS && preflight.reason !== EWC_PREDICTION_READINESS.INCOMPLETE_RESULT) {
    requireReady(preflight);
  }
  const final = await currentStandings(season, dependencies);
  const scored = await dependencies.transaction(async (tx) => {
    const lockedRound = await dependencies.lockSeasonForTransition(guildId, season, tx);
    if (!lockedRound) throw new Error(`No season round exists for ${season}.`);
    if (lockedRound.status === 'scored') return { alreadyCompleted: true, round: lockedRound };
    requireReady(evaluateEwcSeasonScoringReadiness(lockedRound, final, {
      now: dependencies.nowSec(),
      scoreAfter: ewcPredictionScoreAfter(lockedRound, config.ewcPredictions.scoreDelayHours),
    }));
    const predictions = await dependencies.listSeasonPredictions(guildId, season, tx, { forUpdate: true });
    let malformed = 0;
    for (const prediction of predictions) {
      try {
        const score = scoreSeasonPrediction(prediction.picks, final, lockedRound.top_size);
        await dependencies.saveSeasonScore(guildId, season, prediction.user_id, score.score, score.details, tx);
      } catch (operationError) {
        malformed += 1;
        await dependencies.saveSeasonScore(guildId, season, prediction.user_id, 0, malformedDetails(prediction, operationError), tx);
      }
    }
    await dependencies.markSeasonScored(guildId, season, final, tx);
    return { round: lockedRound, predictions, malformed };
  });
  if (scored.alreadyCompleted) {
    if (allowAlreadyComplete) return { season, alreadyCompleted: true, message: `EWC ${season} season predictions are already scored.` };
    throw new Error(`EWC ${season} season predictions are already scored. Reopen them first if you need to re-score.`);
  }
  await refresh(effects, guildId);
  return { season, predictions: scored.predictions.length, malformed: scored.malformed, message: `Scored EWC ${season} season predictions for ${scored.predictions.length} member(s).` };
}

const defaults = {
  getWeek: getEwcWeek,
  getSeason: getEwcSeason,
  lockWeekForTransition: lockEwcWeekForTransition,
  lockSeasonForTransition: lockEwcSeasonForTransition,
  listWeeklyPredictions,
  listSeasonPredictions,
  saveWeeklyScore: saveWeeklyPredictionScore,
  saveSeasonScore: saveSeasonPredictionScore,
  markWeekScored: markEwcWeekScored,
  markWeekScoredWithResults: markEwcWeekScoredWithResults,
  markSeasonScored: markEwcSeasonScored,
  fetchStandings: fetchEwcClubStandings,
  fetchSchedule: fetchEwcEventSchedule,
  fetchWeekResults: fetchEwcWeekGameResults,
  nowSec: () => Math.floor(Date.now() / 1000),
  generateWeeks: generateEwcWeekWindows,
  upsertWeek: upsertEwcWeek,
  setSnapshot: setEwcWeekSnapshot,
  reopenWeek: reopenEwcWeek,
  clearWeeklyScores: clearWeeklyPredictionScores,
  reopenSeason: reopenEwcSeason,
  clearSeasonScores: clearSeasonPredictionScores,
  deleteWeek: deleteEwcWeek,
  transaction,
};

export async function runEwcPredictionAdminOperation({ guildId, season, operation, args = {}, actorId = null, effects = {}, dependencies = {}, allowAlreadyComplete = false }) {
  if (typeof guildId !== 'string' || !guildId || typeof season !== 'string' || !season) throw new Error('A guild and season are required.');
  const validated = validateEwcPredictionAdminOperation(operation, args, { defaultScoreDelayHours: config.ewcPredictions.scoreDelayHours });
  if (!validated.ok) throw new Error(validated.error);
  const input = validated.value;
  const deps = { ...defaults, ...dependencies };

  if (operation === 'refresh_leaderboard') {
    const refreshed = await refresh(effects, guildId);
    return { refreshed, message: refreshed ? 'Prediction leaderboard refreshed.' : 'No prediction leaderboard is configured.' };
  }
  if (operation === 'generate_weeks') {
    const schedule = await deps.fetchSchedule(Number(season));
    const weeks = deps.generateWeeks(schedule?.events || [], input);
    if (!weeks.length) throw new Error(`No dated EWC events were found for ${season}.`);
    const reconciliation = {
      newWeeks: 0,
      unchanged: 0,
      rekeyed: 0,
      added: 0,
      removedUnreferenced: 0,
    };
    for (const week of weeks) {
      const saved = await deps.upsertWeek({
        guildId,
        season,
        weekKey: week.weekKey,
        label: week.label,
        startAt: week.startAt,
        endAt: week.endAt,
        openAt: week.openAt,
        closeAt: week.closeAt,
        scoreAfter: week.scoreAfter,
        games: week.events,
        createdBy: actorId,
      });
      reconciliation.newWeeks += Number(saved?.reconciliation?.newWeek || 0);
      reconciliation.unchanged += Number(saved?.reconciliation?.unchanged || 0);
      reconciliation.rekeyed += Number(saved?.reconciliation?.rekeyed || 0);
      reconciliation.added += Number(saved?.reconciliation?.added || 0);
      reconciliation.removedUnreferenced += Number(saved?.reconciliation?.removedUnreferenced || 0);
    }
    return {
      weeks: weeks.length,
      events: schedule.events.length,
      reconciliation,
      message:
        `Generated ${weeks.length} EWC ${season} weekly prediction round(s): ` +
        `${reconciliation.newWeeks} new, ${reconciliation.unchanged} unchanged, ` +
        `${reconciliation.rekeyed} rekeyed, ${reconciliation.added} event(s) added, ` +
        `${reconciliation.removedUnreferenced} unreferenced event(s) removed.`,
    };
  }
  if (operation === 'snapshot_week') {
    const round = await deps.getWeek(guildId, season, input.weekKey);
    if (!round) throw new Error(`Week \`${input.weekKey}\` does not exist.`);
    const standings = await currentStandings(season, deps);
    await deps.setSnapshot(round.id, input.type, standings);
    return { round: round.week_key, type: input.type, rows: standings.length, message: `Saved ${input.type} snapshot for ${round.label || round.week_key}.` };
  }
  if (operation === 'score_week') return scoreWeek({ guildId, season, weekKey: input.weekKey, dependencies: deps, effects, allowAlreadyComplete });
  if (operation === 'score_season') return scoreSeason({ guildId, season, dependencies: deps, effects, allowAlreadyComplete });
  if (operation === 'reopen_week') {
    const round = await deps.getWeek(guildId, season, input.weekKey);
    if (!round) throw new Error(`Week \`${input.weekKey}\` does not exist.`);
    await deps.transaction(async (tx) => {
      const lockedRound = await deps.lockWeekForTransition(guildId, season, input.weekKey, tx);
      if (!lockedRound) throw new Error(`Week \`${input.weekKey}\` does not exist.`);
      await deps.reopenWeek(lockedRound.id, tx);
      await deps.clearWeeklyScores(lockedRound.id, tx);
    });
    await refresh(effects, guildId);
    return { round: round.week_key, message: `Reopened ${round.label || round.week_key} and cleared its prediction scores.` };
  }
  if (operation === 'reopen_season') {
    const round = await deps.getSeason(guildId, season);
    if (!round) throw new Error(`No season round exists for ${season}.`);
    await deps.transaction(async (tx) => {
      const lockedRound = await deps.lockSeasonForTransition(guildId, season, tx);
      if (!lockedRound) throw new Error(`No season round exists for ${season}.`);
      await deps.reopenSeason(guildId, season, tx);
      await deps.clearSeasonScores(guildId, season, tx);
    });
    await refresh(effects, guildId);
    return { season, message: `Reopened EWC ${season} season predictions and cleared season scores.` };
  }
  if (operation === 'delete_week') {
    const round = await deps.getWeek(guildId, season, input.weekKey);
    if (!round) {
      if (allowAlreadyComplete) return { round: input.weekKey, alreadyCompleted: true, message: `${input.weekKey} was already deleted.` };
      throw new Error(`Week \`${input.weekKey}\` does not exist.`);
    }
    const result = await deps.transaction(async (tx) => {
      const lockedRound = await deps.lockWeekForTransition(guildId, season, input.weekKey, tx);
      if (!lockedRound) {
        if (allowAlreadyComplete) return { alreadyCompleted: true, predictions: 0 };
        throw new Error(`Week \`${input.weekKey}\` does not exist.`);
      }
      if (lockedRound.status === 'scored') throw new Error('This week is already scored. Reopen it first if you really want to delete it.');
      return deps.deleteWeek(lockedRound.id, tx);
    });
    if (result.alreadyCompleted) return { round: input.weekKey, alreadyCompleted: true, message: `${input.weekKey} was already deleted.` };
    await refresh(effects, guildId);
    return { round: round.week_key, predictions: result.predictions, message: `Deleted ${round.label || round.week_key} (${result.predictions} prediction(s) removed).` };
  }
  throw new Error('Unsupported prediction operation.');
}
