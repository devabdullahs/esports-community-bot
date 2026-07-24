import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EWC_PREDICTION_READINESS,
  evaluateEwcSeasonScoringReadiness,
  evaluateEwcWeekScoringReadiness,
  mergeEwcGameResults,
} from '../src/lib/ewcPredictions.js';

const NOW = 10_000;
const BASELINE = [{ team: 'Team Falcons', rank: 1, points: 100 }];
const FINAL = [{ team: 'Team Falcons', rank: 1, points: 200 }];

function completeResult(gameKey, fetchedAt = NOW) {
  return {
    gameKey,
    placements: [
      { club: 'Winner', place: '1', points: 1000 },
      { club: 'Runner-up', place: '2', points: 750 },
      { club: 'Third', place: '3', points: 500 },
      { club: 'Fourth', place: '4', points: 300 },
      { club: 'Top eight', place: '5-8', points: 200 },
    ],
    evidence: {
      kind: 'club-points-prize-table',
      authoritative: true,
      coveredRanks: [1, 2, 3, 4, 5, 6, 7, 8],
    },
    fetchedAt,
  };
}

function aggregateRound(overrides = {}) {
  return {
    status: 'closed',
    open_at: NOW - 1000,
    close_at: NOW - 500,
    score_after: NOW - 100,
    baseline: BASELINE,
    games: [],
    ...overrides,
  };
}

function perGameRound(overrides = {}) {
  return {
    status: 'closed',
    open_at: NOW - 1000,
    close_at: NOW - 500,
    score_after: NOW - 100,
    games: [{ key: 'game-1', lockAt: NOW - 500, endAt: NOW - 200 }],
    ...overrides,
  };
}

test('weekly readiness reports every structural gate with stable reason codes', () => {
  assert.equal(
    evaluateEwcWeekScoringReadiness(aggregateRound({ open_at: NOW + 1 }), { now: NOW, finalStandings: FINAL }).reason,
    EWC_PREDICTION_READINESS.NOT_OPEN,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(perGameRound({ games: [{ key: 'game-1', lockAt: NOW + 1, endAt: NOW + 100 }] }), {
      now: NOW,
      results: [],
    }).reason,
    EWC_PREDICTION_READINESS.GAMES_UNLOCKED,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(aggregateRound({ status: 'open' }), { now: NOW, finalStandings: FINAL }).reason,
    EWC_PREDICTION_READINESS.ROUND_NOT_CLOSED,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(aggregateRound({ score_after: NOW + 1 }), { now: NOW, finalStandings: FINAL }).reason,
    EWC_PREDICTION_READINESS.SCORE_DELAY_PENDING,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(aggregateRound({ baseline: [] }), { now: NOW, finalStandings: FINAL }).reason,
    EWC_PREDICTION_READINESS.MISSING_BASELINE,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(aggregateRound(), { now: NOW, finalStandings: [] }).reason,
    EWC_PREDICTION_READINESS.MISSING_RESULTS,
  );
  assert.deepEqual(
    evaluateEwcWeekScoringReadiness(aggregateRound(), { now: NOW, finalStandings: FINAL }),
    { ready: true, reason: EWC_PREDICTION_READINESS.READY },
  );
});

test('per-game readiness distinguishes missing, untrusted, incomplete, stale, and ready results', () => {
  const round = perGameRound();
  assert.equal(
    evaluateEwcWeekScoringReadiness(round, { now: NOW, results: [] }).reason,
    EWC_PREDICTION_READINESS.MISSING_RESULTS,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(round, {
      now: NOW,
      results: [{ ...completeResult('game-1'), evidence: null }],
    }).reason,
    EWC_PREDICTION_READINESS.UNTRUSTED_RESULT,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(round, {
      now: NOW,
      results: [{
        ...completeResult('game-1'),
        placements: completeResult('game-1').placements.slice(0, 4),
        evidence: { kind: 'club-points-prize-table', authoritative: true, coveredRanks: [1, 2, 3, 4] },
      }],
    }).reason,
    EWC_PREDICTION_READINESS.INCOMPLETE_RESULT,
  );
  assert.equal(
    evaluateEwcWeekScoringReadiness(round, { now: NOW, results: [completeResult('game-1', NOW - 300)] }).reason,
    EWC_PREDICTION_READINESS.STALE_RESULT,
  );
  assert.deepEqual(
    evaluateEwcWeekScoringReadiness(round, { now: NOW, results: [completeResult('game-1')] }),
    { ready: true, reason: EWC_PREDICTION_READINESS.READY },
  );
});

test('season readiness requires a closed delayed round and a canonical full top set', () => {
  const round = {
    status: 'closed',
    open_at: NOW - 1000,
    close_at: NOW - 500,
    score_after: NOW - 100,
    top_size: 3,
  };
  const complete = [
    { team: 'Team Falcons', rank: 1 },
    { team: 'T1', rank: 2 },
    { team: 'Team Liquid', rank: 3 },
  ];
  assert.equal(
    evaluateEwcSeasonScoringReadiness({ ...round, status: 'open' }, complete, { now: NOW }).reason,
    EWC_PREDICTION_READINESS.ROUND_NOT_CLOSED,
  );
  assert.equal(
    evaluateEwcSeasonScoringReadiness({ ...round, score_after: NOW + 1 }, complete, { now: NOW }).reason,
    EWC_PREDICTION_READINESS.SCORE_DELAY_PENDING,
  );
  assert.equal(
    evaluateEwcSeasonScoringReadiness(round, [], { now: NOW }).reason,
    EWC_PREDICTION_READINESS.MISSING_RESULTS,
  );
  assert.equal(
    evaluateEwcSeasonScoringReadiness(round, [...complete.slice(0, 2), { team: 'T1', rank: 3 }], { now: NOW }).reason,
    EWC_PREDICTION_READINESS.INCOMPLETE_RESULT,
  );
  assert.deepEqual(
    evaluateEwcSeasonScoringReadiness(round, complete, { now: NOW }),
    { ready: true, reason: EWC_PREDICTION_READINESS.READY },
  );
});

test('quality-aware merging preserves a complete stored snapshot across a transient parse miss', () => {
  const stored = completeResult('game-1', NOW - 100);
  const transient = {
    gameKey: 'game-1',
    placements: [],
    evidence: null,
    fetchedAt: NOW,
  };
  assert.equal(mergeEwcGameResults([stored], [transient])[0], stored);

  const refreshed = completeResult('game-1', NOW + 1);
  assert.equal(mergeEwcGameResults([stored], [refreshed])[0], refreshed);
});
