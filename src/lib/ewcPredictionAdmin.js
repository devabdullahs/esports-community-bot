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
  generateEwcWeekWindows,
  pendingEwcGameResults,
  scorePerGameWeeklyPrediction,
  scoreSeasonPrediction,
  scoreWeeklyPrediction,
} from './ewcPredictions.js';
import { fetchEwcClubStandings, fetchEwcEventSchedule, fetchEwcWeekGameResults } from '../services/liquipedia.js';

export { EWC_PREDICTION_ADMIN_OPERATIONS, validateEwcPredictionAdminOperation } from './ewcPredictionOperationValidation.js';

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
  // Network resolution completes before the scoring transaction. This keeps the
  // lock short and prevents a Liquipedia request from holding database state.
  const results = perGame ? (round.results?.length ? round.results : await dependencies.fetchWeekResults(round.games)) : [];
  const missing = perGame ? pendingEwcGameResults(results, round.games) : [];
  if (missing.length) throw new Error(`Missing complete placement results for: ${missing.map((row) => row.game || row.event || row.gameKey).join(', ')}.`);
  if (!perGame && !(round.baseline || []).length) throw new Error('This week has no baseline snapshot yet.');
  const final = perGame ? round.final || [] : round.final?.length ? round.final : await currentStandings(season, dependencies);
  if (!perGame && !final.length) throw new Error('Could not fetch the final standings to score this week. Try again in a moment.');

  const scored = await dependencies.transaction(async (tx) => {
    const lockedRound = await dependencies.lockWeekForTransition(guildId, season, weekKey, tx);
    if (!lockedRound) throw new Error(`Week \`${weekKey}\` does not exist.`);
    if (lockedRound.status === 'scored') return { alreadyCompleted: true, round: lockedRound };
    if (JSON.stringify(lockedRound.games || []) !== JSON.stringify(round.games || [])) {
      throw new Error(`Week \`${weekKey}\` changed while scoring. Retry the operation.`);
    }
    const lockedPerGame = Array.isArray(lockedRound.games) && lockedRound.games.length > 0;
    const lockedResults = lockedPerGame ? (lockedRound.results?.length ? lockedRound.results : results) : [];
    const lockedFinal = lockedPerGame ? lockedRound.final || [] : lockedRound.final?.length ? lockedRound.final : final;
    if (!lockedPerGame && !(lockedRound.baseline || []).length) throw new Error('This week has no baseline snapshot yet.');
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
  const final = await currentStandings(season, dependencies);
  const scored = await dependencies.transaction(async (tx) => {
    const lockedRound = await dependencies.lockSeasonForTransition(guildId, season, tx);
    if (!lockedRound) throw new Error(`No season round exists for ${season}.`);
    if (lockedRound.status === 'scored') return { alreadyCompleted: true, round: lockedRound };
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
    for (const week of weeks) {
      await deps.upsertWeek({
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
    }
    return { weeks: weeks.length, events: schedule.events.length, message: `Generated ${weeks.length} EWC ${season} weekly prediction round(s).` };
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
