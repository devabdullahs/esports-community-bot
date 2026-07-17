import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EWC_PREDICTION_ACHIEVEMENTS,
  EWC_PREDICTION_ACHIEVEMENT_IDS,
  deriveEwcPredictionAchievements,
} from '../src/lib/ewcPredictionAchievements.js';

function scoredWeek(score, details = null) {
  return { status: 'scored', score, details };
}

function perGameDetails({ allWinners = false, game = 'Valorant', correctWinner = false } = {}) {
  return {
    mode: 'per-game',
    allWinners,
    picks: [{ game, points: correctWinner ? 1000 : 750, late: false, resultAvailable: true }],
  };
}

test('achievement definitions keep stable IDs, thresholds, and EN/AR labels together', () => {
  assert.deepEqual(EWC_PREDICTION_ACHIEVEMENT_IDS, [
    'weekly-winner',
    'top-ten',
    'top-twenty',
    'perfect-week',
    'scoring-streak',
    'game-specialist',
    'consistent-predictor',
  ]);
  for (const achievement of Object.values(EWC_PREDICTION_ACHIEVEMENTS)) {
    assert.ok(Object.keys(achievement.threshold).length > 0);
    assert.ok(achievement.labels.en);
    assert.ok(achievement.labels.ar);
  }
});

test('derives every result-based achievement and compact streak/specialist stats', () => {
  const result = deriveEwcPredictionAchievements({
    rank: 3,
    weeklyWins: 1,
    weeksScored: 5,
    weeklyRows: [
      scoredWeek(2_300, perGameDetails({ allWinners: true, correctWinner: true })),
      scoredWeek(1_000, perGameDetails({ correctWinner: true })),
      scoredWeek(1_000, perGameDetails({ correctWinner: true })),
      scoredWeek(750, perGameDetails({ game: 'Apex Legends', correctWinner: false })),
      scoredWeek(500, perGameDetails({ game: 'Apex Legends', correctWinner: false })),
    ],
  });

  assert.deepEqual(result.ids, [
    'weekly-winner',
    'top-ten',
    'perfect-week',
    'scoring-streak',
    'game-specialist',
    'consistent-predictor',
  ]);
  assert.deepEqual(result.stats, {
    currentScoringStreak: 5,
    longestScoringStreak: 5,
    specialistGame: 'Valorant',
    specialistCorrectWinners: 3,
    scoredWeeks: 5,
  });
});

test('top-ten replaces top-twenty while ranks 11 through 20 earn top-twenty', () => {
  assert.deepEqual(
    deriveEwcPredictionAchievements({ rank: 10 }).ids,
    ['top-ten'],
  );
  assert.deepEqual(
    deriveEwcPredictionAchievements({ rank: 20 }).ids,
    ['top-twenty'],
  );
  assert.deepEqual(deriveEwcPredictionAchievements({ rank: 21 }).ids, []);
});

test('zero-score ties never produce wins and break a scoring streak', () => {
  const result = deriveEwcPredictionAchievements({
    weeklyWins: 0,
    weeksScored: 4,
    weeklyRows: [
      scoredWeek(100),
      scoredWeek(50),
      scoredWeek(0),
      scoredWeek(25),
    ],
  });

  assert.equal(result.ids.includes('weekly-winner'), false);
  assert.equal(result.ids.includes('scoring-streak'), false);
  assert.deepEqual(result.stats, {
    currentScoringStreak: 1,
    longestScoringStreak: 2,
    specialistGame: null,
    specialistCorrectWinners: 0,
    scoredWeeks: 4,
  });
});

test('no predictions produce no derived achievements', () => {
  assert.deepEqual(deriveEwcPredictionAchievements(), {
    ids: [],
    stats: {
      currentScoringStreak: 0,
      longestScoringStreak: 0,
      specialistGame: null,
      specialistCorrectWinners: 0,
      scoredWeeks: 0,
    },
  });
});
