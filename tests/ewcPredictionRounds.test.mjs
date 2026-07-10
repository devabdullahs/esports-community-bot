import assert from 'node:assert/strict';
import test from 'node:test';

import { categorizeEwcPredictionRounds, selectCurrentOpenEwcWeek } from '../src/lib/ewcPredictionRounds.js';

const NOW = 2_000;

function week(overrides = {}) {
  return {
    week_key: 'week-1',
    status: 'open',
    open_at: 1_000,
    close_at: 5_000,
    score_after: 6_000,
    games: [{ key: 'game-a', lockAt: 4_000 }],
    ...overrides,
  };
}

test('categorizeEwcPredictionRounds returns empty buckets when no rounds exist', () => {
  assert.deepEqual(categorizeEwcPredictionRounds([], NOW), { actionable: [], upcoming: [], awaitingScoring: [] });
});

test('categorizeEwcPredictionRounds returns one open round with its next game lock', () => {
  const categorized = categorizeEwcPredictionRounds([week()], NOW);
  assert.equal(categorized.actionable.length, 1);
  assert.equal(categorized.actionable[0].week_key, 'week-1');
  assert.equal(categorized.actionable[0].nextLockAt, 4_000);
});

test('categorizeEwcPredictionRounds keeps every overlapping actionable round ordered by its next game lock', () => {
  const categorized = categorizeEwcPredictionRounds([
    week({ week_key: 'later-close', close_at: 9_000, games: [{ key: 'later', lockAt: 3_500 }] }),
    week({ week_key: 'urgent-close', close_at: 3_000, games: [{ key: 'urgent', lockAt: 3_000 }] }),
  ], NOW);

  assert.deepEqual(categorized.actionable.map((round) => round.week_key), ['urgent-close', 'later-close']);
  assert.equal(selectCurrentOpenEwcWeek(categorized.actionable, NOW)?.week_key, 'urgent-close');
});

test('categorizeEwcPredictionRounds orders partly open rounds by their remaining game lock and breaks ties stably', () => {
  const categorized = categorizeEwcPredictionRounds([
    week({ week_key: 'z-tie', close_at: 9_000, games: [{ key: 'old', lockAt: 1_500 }, { key: 'new', lockAt: 3_000 }] }),
    week({ week_key: 'a-tie', close_at: 8_000, games: [{ key: 'old', lockAt: 1_500 }, { key: 'new', lockAt: 3_000 }] }),
    week({ week_key: 'later', close_at: 4_000, games: [{ key: 'later', lockAt: 3_100 }] }),
  ], NOW);

  assert.deepEqual(categorized.actionable.map((round) => round.week_key), ['a-tie', 'z-tie', 'later']);
  assert.equal(categorized.actionable[0].nextLockAt, 3_000);
});

test('categorizeEwcPredictionRounds orders upcoming and awaiting-scoring rounds deterministically', () => {
  const categorized = categorizeEwcPredictionRounds([
    week({ week_key: 'future-later', open_at: 5_000, close_at: 7_000 }),
    week({ week_key: 'future-first', open_at: 4_000, close_at: 6_000 }),
    week({ week_key: 'awaiting-old', close_at: 1_500, games: [{ key: 'locked', lockAt: 1_500 }] }),
    week({ week_key: 'awaiting-new', close_at: 1_800, games: [{ key: 'locked', lockAt: 1_800 }] }),
  ], NOW);

  assert.deepEqual(categorized.upcoming.map((round) => round.week_key), ['future-first', 'future-later']);
  assert.deepEqual(categorized.awaitingScoring.map((round) => round.week_key), ['awaiting-new', 'awaiting-old']);
});
