import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';

const {
  normalizeClubName,
  clubNameKeys,
  uniqueClubPicks,
  parsePredictionDate,
  weeklyPointDeltas,
  scoreWeeklyPrediction,
  scoreSeasonPrediction,
  generateEwcWeekWindows,
  WEEKLY_TOP_THREE_SWEEP_BONUS,
  SEASON_EXACT_RANK_BONUS,
} = await import('../src/lib/ewcPredictions.js');

// ─── Step 2: Name normalization and pick dedupe ──────────────────────────────

test('normalizeClubName strips zero-width chars, collapses whitespace, lowercases', () => {
  // The string below contains a U+200B (zero-width space) between "Team" and "Falcons"
  assert.equal(normalizeClubName('  Team​ Falcons '), 'team falcons');
});

test('normalizeClubName handles null/undefined gracefully', () => {
  assert.equal(normalizeClubName(null), '');
  assert.equal(normalizeClubName(undefined), '');
});

test('clubNameKeys includes normalized form and form without leading "team "', () => {
  const keys = clubNameKeys('Team Falcons');
  assert.ok(keys.includes('team falcons'), 'should include "team falcons"');
  assert.ok(keys.includes('falcons'), 'should include "falcons" (sans team prefix)');
});

test('uniqueClubPicks dedupes by club name keys — "team falcons" is dropped, "FALCONS x" survives', () => {
  // "team falcons" dedupes against "Team Falcons" (same normalized key).
  // "FALCONS x" normalizes to "falcons x" which does NOT share a key with "team falcons",
  // so it survives as a distinct pick.
  const result = uniqueClubPicks(['Team Falcons', 'team falcons', 'FALCONS x'], undefined);
  assert.deepEqual(result, ['Team Falcons', 'FALCONS x']);
});

test('uniqueClubPicks throws when deduped count differs from requiredCount', () => {
  // 'A' appears twice → deduped to 2 entries, but 3 required
  assert.throws(
    () => uniqueClubPicks(['A', 'A', 'B'], 3),
    /3 different clubs/,
  );
});

test('uniqueClubPicks returns 3 entries unchanged when all distinct', () => {
  const result = uniqueClubPicks(['A', 'B', 'C'], 3);
  assert.deepEqual(result, ['A', 'B', 'C']);
});

// ─── Step 3: weeklyPointDeltas ───────────────────────────────────────────────

const baseline = [
  { team: 'Falcons', rank: 1, points: 100 },
  { team: 'T1', rank: 2, points: 80 },
  { team: 'Gen.G', rank: 3, points: 60 },
];

const finalSame = [
  { team: 'Falcons', rank: 1, points: 150 },
  { team: 'T1', rank: 2, points: 130 },
  { team: 'Gen.G', rank: 3, points: 60 }, // delta = 0 → excluded
];

test('weeklyPointDeltas excludes rows with delta <= 0', () => {
  const deltas = weeklyPointDeltas(baseline, finalSame);
  assert.ok(
    !deltas.some((r) => r.team === 'Gen.G'),
    'Gen.G (delta 0) must not appear in result',
  );
  assert.equal(deltas.length, 2);
});

test('weeklyPointDeltas assigns shared rank to tied weekly-point values, ordered by finalRank', () => {
  // Falcons delta=50, T1 delta=50 → both rank 1 (tie). Falcons comes first (finalRank 1 < 2).
  const deltas = weeklyPointDeltas(baseline, finalSame);
  assert.equal(deltas[0].team, 'Falcons');
  assert.equal(deltas[0].weeklyPoints, 50);
  assert.equal(deltas[0].rank, 1);
  assert.equal(deltas[1].team, 'T1');
  assert.equal(deltas[1].weeklyPoints, 50);
  assert.equal(deltas[1].rank, 1); // tied rank — NOT rank 2
});

test('weeklyPointDeltas gives full points as delta when team only appears in final (baselinePoints = 0)', () => {
  const finalWithNew = [
    ...finalSame,
    { team: 'NewTeam', rank: 4, points: 70 },
  ];
  const deltas = weeklyPointDeltas(baseline, finalWithNew);
  const newRow = deltas.find((r) => r.team === 'NewTeam');
  assert.ok(newRow, 'NewTeam should appear in deltas');
  assert.equal(newRow.baselinePoints, 0);
  assert.equal(newRow.weeklyPoints, 70);
});

test('weeklyPointDeltas returns [] for empty or null inputs', () => {
  assert.deepEqual(weeklyPointDeltas([], []), []);
  assert.deepEqual(weeklyPointDeltas(null, null), []);
});

// ─── Step 4: scoreWeeklyPrediction ──────────────────────────────────────────

const baselineW = [
  { team: 'Falcons', rank: 1, points: 100 },
  { team: 'T1', rank: 2, points: 80 },
  { team: 'Gen.G', rank: 3, points: 60 },
];
const finalW = [
  { team: 'Falcons', rank: 1, points: 160 }, // delta 60
  { team: 'T1', rank: 2, points: 120 },      // delta 40
  { team: 'Gen.G', rank: 3, points: 100 },   // delta 40
];

test('scoreWeeklyPrediction: all 3 picks in top-3 earns sweep bonus', () => {
  // deltas: Falcons=60 (rank 1), T1=40 (rank 2, tied), Gen.G=40 (rank 2, tied)
  // all picks land in top-3 set → bonus = 300
  const result = scoreWeeklyPrediction(['Falcons', 'T1', 'Gen.G'], baselineW, finalW);
  assert.equal(result.details.bonus, WEEKLY_TOP_THREE_SWEEP_BONUS); // 300
  assert.equal(result.score, 60 + 40 + 40 + 300); // 440
});

test('scoreWeeklyPrediction: one unknown pick contributes 0 points and suppresses bonus', () => {
  const result = scoreWeeklyPrediction(['Falcons', 'T1', 'Unknown'], baselineW, finalW);
  assert.equal(result.details.bonus, 0);
  // Falcons=60, T1=40, Unknown=0; no bonus
  assert.equal(result.score, 100);
});

test('scoreWeeklyPrediction: case/prefix variant "team falcons" matches standings team "Falcons"', () => {
  const result = scoreWeeklyPrediction(['team falcons', 'T1', 'Gen.G'], baselineW, finalW);
  assert.equal(result.details.picks[0].matchedTeam, 'Falcons');
  assert.equal(result.details.picks[0].weeklyPoints, 60);
  assert.equal(result.details.bonus, WEEKLY_TOP_THREE_SWEEP_BONUS);
  assert.equal(result.score, 440);
});

test('scoreWeeklyPrediction: wrong pick count (2 picks) throws', () => {
  assert.throws(
    () => scoreWeeklyPrediction(['Falcons', 'T1'], baselineW, finalW),
    /3 different clubs/,
  );
});

// ─── Step 5: scoreSeasonPrediction ──────────────────────────────────────────

const standings10 = Array.from({ length: 10 }, (_, i) => ({
  team: `Team${i + 1}`,
  rank: i + 1,
  points: (10 - i) * 100,
}));

test('scoreSeasonPrediction: exact rank match gives hitPoints=1000 + exactBonus=250', () => {
  // Pick index 0 → predictedRank 1; Team1 has actualRank 1
  // hitPoints = max(1, 10 - 1 + 1) * 100 = 1000
  const result = scoreSeasonPrediction(['Team1', 'Team2', 'Team3'], standings10, 10);
  const pick0 = result.details.picks[0];
  assert.equal(pick0.hitPoints, 1000);
  assert.equal(pick0.exactBonus, SEASON_EXACT_RANK_BONUS); // 250
  assert.equal(pick0.points, 1250);
});

test('scoreSeasonPrediction: in top-10 but wrong slot earns hitPoints only, no exactBonus', () => {
  // Pick "Team2" at index 0 → predictedRank 1, actualRank 2
  // hitPoints = max(1, 10 - 2 + 1) * 100 = 900; exactBonus = 0
  const result = scoreSeasonPrediction(['Team2', 'Team3', 'Team4'], standings10, 10);
  const pick0 = result.details.picks[0];
  assert.equal(pick0.matchedTeam, 'Team2');
  assert.equal(pick0.actualRank, 2);
  assert.equal(pick0.predictedRank, 1);
  assert.equal(pick0.hitPoints, 900);
  assert.equal(pick0.exactBonus, 0);
  assert.equal(pick0.points, 900);
});

test('scoreSeasonPrediction: pick outside final top-topSize scores 0 with matchedTeam null', () => {
  // "Team11" is not in top-10
  const result = scoreSeasonPrediction(['Team11'], standings10, 10);
  const pick0 = result.details.picks[0];
  assert.equal(pick0.matchedTeam, null);
  assert.equal(pick0.points, 0);
});

test('scoreSeasonPrediction: picks beyond topSize are silently ignored', () => {
  // 15 picks provided but topSize=10 → details.picks.length should be 10
  const manyPicks = Array.from({ length: 15 }, (_, i) => `Team${i + 1}`);
  const result = scoreSeasonPrediction(manyPicks, standings10, 10);
  assert.equal(result.details.picks.length, 10);
});

// ─── Step 6: generateEwcWeekWindows and parsePredictionDate ─────────────────

// Fixed epoch for deterministic window math
const T = 1750000000;
const DAY = 86400;
const WEEK = 7 * DAY;

test('generateEwcWeekWindows: gap week (no events) is skipped; index does not advance', () => {
  // Event 1 starts at T, event 2 starts at T+14 days.
  // Week 1: [T, T+WEEK-1] — has event 1. Week 2 (T+WEEK): [T+7d, T+14d-1] — no events → SKIPPED.
  // Week 3 (T+14d): has event 2 → becomes week-2 (index advances only for non-empty weeks).
  const events = [
    { startAt: T, endAt: T + 6 * DAY },
    { startAt: T + 14 * DAY, endAt: T + 20 * DAY },
  ];
  const windows = generateEwcWeekWindows(events);
  // Documents gap-week behavior: only 2 output weeks for 3 calendar weeks,
  // because the middle 7-day window has no events and is skipped.
  assert.equal(windows.length, 2);
  assert.equal(windows[0].weekKey, 'week-1');
  assert.equal(windows[1].weekKey, 'week-2');
});

test('generateEwcWeekWindows: week 1 openAt/closeAt/scoreAfter offsets are correct', () => {
  const events = [
    { startAt: T, endAt: T + 6 * DAY },
    { startAt: T + 14 * DAY, endAt: T + 20 * DAY },
  ];
  const windows = generateEwcWeekWindows(events);
  const w1 = windows[0];
  assert.equal(w1.openAt, T - 48 * 3600);   // openBeforeHours=48
  assert.equal(w1.closeAt, T);               // closeAt = startAt
  assert.equal(w1.scoreAfter, T + WEEK - 1 + 24 * 3600); // endAt + scoreDelayHours=24
});

test('parsePredictionDate: Discord timestamp formats', () => {
  assert.equal(parsePredictionDate('<t:1750000000:f>'), 1750000000);
  assert.equal(parsePredictionDate('<t:1750000000:R>'), 1750000000);
  assert.equal(parsePredictionDate('<t:1750000000>'), 1750000000);
});

test('parsePredictionDate: 10-digit unix string', () => {
  assert.equal(parsePredictionDate('1750000000'), 1750000000);
});

test('parsePredictionDate: 13-digit millisecond string is floored to seconds', () => {
  assert.equal(parsePredictionDate('1750000000000'), 1750000000);
});

test('parsePredictionDate: empty string and null return null', () => {
  assert.equal(parsePredictionDate(''), null);
  assert.equal(parsePredictionDate(null), null);
});

test('parsePredictionDate: garbage string throws', () => {
  assert.throws(() => parsePredictionDate('garbage'), /Discord timestamp/);
});

test('parsePredictionDate: YYYY-MM-DD HH:mm is interpreted as Riyadh time (+03:00)', () => {
  // Hardcoded expected value: Date.parse('2026-07-08T00:00+03:00') / 1000
  // This documents that bare datetime strings use Asia/Riyadh offset (+03:00).
  const expected = 1783458000; // = Math.floor(Date.parse('2026-07-08T00:00+03:00') / 1000)
  assert.equal(parsePredictionDate('2026-07-08 00:00'), expected);
});
