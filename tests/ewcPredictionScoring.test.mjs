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
  scorePerGameWeeklyPrediction,
  ewcPlacementPoints,
  pendingEwcGameResults,
  perGamePredictionRoundLocked,
  dueEwcGamesForResults,
  mergeEwcGameResults,
  effectiveEwcWeekStatus,
  generateEwcWeekWindows,
  WEEKLY_TOP_THREE_SWEEP_BONUS,
  WEEKLY_ALL_GAME_WINNERS_BONUS,
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

test('scoreSeasonPrediction: empty picks score 0 with no pick details', () => {
  const result = scoreSeasonPrediction([], standings10, 10);
  assert.equal(result.score, 0);
  assert.deepEqual(result.details.picks, []);
});

test('scoreSeasonPrediction: fewer picks than topSize only score the provided picks', () => {
  const result = scoreSeasonPrediction(['Team1', 'Team4'], standings10, 10);
  assert.equal(result.details.picks.length, 2);
  assert.deepEqual(result.details.picks.map((pick) => pick.points), [1250, 700]);
  assert.equal(result.details.picks[0].hitPoints, 1000);
  assert.equal(result.details.picks[0].exactBonus, SEASON_EXACT_RANK_BONUS);
  assert.equal(result.details.picks[1].hitPoints, 700);
  assert.equal(result.details.picks[1].exactBonus, 0);
  assert.equal(result.score, 1950);
});

test('scoreSeasonPrediction: topSize boundary scores 100 points and rank beyond topSize scores 0', () => {
  const boundaryStandings = Array.from({ length: 11 }, (_, i) => ({
    team: `Boundary${i + 1}`,
    rank: i + 1,
    points: (11 - i) * 100,
  }));
  const result = scoreSeasonPrediction(['Boundary10', 'Boundary11'], boundaryStandings, 10);
  const boundary = result.details.picks[0];
  assert.equal(boundary.matchedTeam, 'Boundary10');
  assert.equal(boundary.actualRank, 10);
  assert.equal(boundary.hitPoints, 100);
  assert.equal(boundary.points, 100);

  const outside = result.details.picks[1];
  assert.equal(outside.matchedTeam, null);
  assert.equal(outside.points, 0);
  assert.equal(result.score, 100);
});

test('scoreSeasonPrediction: exact-rank bonus applies at the matching predicted slot', () => {
  const result = scoreSeasonPrediction(['Unknown1', 'Unknown2', 'Team3'], standings10, 10);
  const exact = result.details.picks[2];
  assert.equal(exact.matchedTeam, 'Team3');
  assert.equal(exact.actualRank, 3);
  assert.equal(exact.predictedRank, 3);
  assert.equal(exact.hitPoints, 800);
  assert.equal(exact.exactBonus, SEASON_EXACT_RANK_BONUS);
  assert.equal(exact.points, 800 + SEASON_EXACT_RANK_BONUS);
  assert.equal(result.score, 800 + SEASON_EXACT_RANK_BONUS);
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

// ─── Per-game weekly scoring (the model production runs) ─────────────────────
//
// picks_json for a per-game round is an array of objects:
//   [{ gameKey, game, event, pick, pickedAt }, ...]
// results is an array of { gameKey, placements: [{ club, points, place, participant }] }.
// Placement points follow EWC_POINTS_BY_RANK: 1→1000, 2→750, 3→500, 4→300, 5→200,
// 6→150, 7→100, 8→50, anything else (incl. outside top-8) → 0.

test('ewcPlacementPoints: maps the official EWC rank→points table; outside top-8 → 0', () => {
  assert.equal(ewcPlacementPoints('1st'), 1000);
  assert.equal(ewcPlacementPoints('2nd'), 750);
  assert.equal(ewcPlacementPoints('3rd'), 500);
  assert.equal(ewcPlacementPoints('4th'), 300);
  assert.equal(ewcPlacementPoints('5th'), 200);
  assert.equal(ewcPlacementPoints('6th'), 150);
  assert.equal(ewcPlacementPoints('7th'), 100);
  assert.equal(ewcPlacementPoints('8th'), 50);
  assert.equal(ewcPlacementPoints('9th'), 0); // outside top-8
  assert.equal(ewcPlacementPoints('9th-12th'), 0); // first number wins, still outside top-8
  assert.equal(ewcPlacementPoints(''), 0);
  assert.equal(ewcPlacementPoints(null), 0);
});

const GAMES = [
  { key: 'valorant-1', game: 'Valorant', event: 'EWC Valorant' },
  { key: 'apex-2', game: 'Apex Legends', event: 'EWC ALGS' },
];

function resultsFor({ valorantWinner = 'Team Falcons', apexWinner = 'Team Liquid' } = {}) {
  return [
    {
      gameKey: 'valorant-1',
      placements: [
        { club: valorantWinner, points: 1000, place: '1st' },
        { club: 'Team Vitality', points: 750, place: '2nd' },
      ],
    },
    {
      gameKey: 'apex-2',
      placements: [
        { club: apexWinner, points: 1000, place: '1st' },
        { club: 'TSM', points: 750, place: '2nd' },
      ],
    },
  ];
}

test('scorePerGameWeeklyPrediction: happy path — correct winner per game scores per-rank points', () => {
  const picks = [
    { gameKey: 'valorant-1', pick: 'Team Vitality' }, // 2nd → 750
    { gameKey: 'apex-2', pick: 'Team Liquid' }, // 1st → 1000
  ];
  const out = scorePerGameWeeklyPrediction(picks, GAMES, resultsFor());
  assert.equal(out.details.mode, 'per-game');
  assert.equal(out.details.picks.length, 2);
  const valorant = out.details.picks.find((p) => p.gameKey === 'valorant-1');
  assert.equal(valorant.points, 750);
  assert.equal(valorant.matchedClub, 'Team Vitality');
  const apex = out.details.picks.find((p) => p.gameKey === 'apex-2');
  assert.equal(apex.points, 1000);
  // No all-winners bonus: only one of the two picks is a winner.
  assert.equal(out.details.allWinners, false);
  assert.equal(out.details.bonus, 0);
  assert.equal(out.score, 1750);
});

test('scorePerGameWeeklyPrediction: picking every game winner adds the all-winners bonus', () => {
  const picks = [
    { gameKey: 'valorant-1', pick: 'Team Falcons' }, // 1st → 1000
    { gameKey: 'apex-2', pick: 'Team Liquid' }, // 1st → 1000
  ];
  const out = scorePerGameWeeklyPrediction(picks, GAMES, resultsFor());
  assert.equal(out.details.allWinners, true);
  assert.equal(out.details.bonus, WEEKLY_ALL_GAME_WINNERS_BONUS);
  assert.equal(out.score, 1000 + 1000 + WEEKLY_ALL_GAME_WINNERS_BONUS);
});

test('scorePerGameWeeklyPrediction: single-game winner does not earn the all-winners bonus', () => {
  const picks = [{ gameKey: 'valorant-1', pick: 'Team Falcons' }];
  const out = scorePerGameWeeklyPrediction(picks, [GAMES[0]], [resultsFor()[0]]);
  const valorant = out.details.picks.find((p) => p.gameKey === 'valorant-1');
  assert.equal(valorant.points, 1000);
  // ewcPredictions.js:258 gates the all-winners bonus behind details.length > 1.
  assert.equal(out.details.allWinners, false);
  assert.equal(out.details.bonus, 0);
  assert.equal(out.score, 1000);
});

test('scorePerGameWeeklyPrediction: picking every winner in a three-game round adds the all-winners bonus', () => {
  const games = [
    ...GAMES,
    { key: 'chess-3', game: 'Chess', event: 'EWC Chess' },
  ];
  const results = [
    ...resultsFor(),
    {
      gameKey: 'chess-3',
      placements: [
        { club: 'Team Spirit', points: 1000, place: '1st' },
        { club: 'Team BDS', points: 750, place: '2nd' },
      ],
    },
  ];
  const picks = [
    { gameKey: 'valorant-1', pick: 'Team Falcons' },
    { gameKey: 'apex-2', pick: 'Team Liquid' },
    { gameKey: 'chess-3', pick: 'Team Spirit' },
  ];
  const out = scorePerGameWeeklyPrediction(picks, games, results);
  assert.equal(out.details.allWinners, true);
  assert.equal(out.details.bonus, WEEKLY_ALL_GAME_WINNERS_BONUS);
  assert.equal(out.score, 3 * 1000 + WEEKLY_ALL_GAME_WINNERS_BONUS);
});

test('scorePerGameWeeklyPrediction: a pending game (no result) scores 0 for that game and blocks the bonus', () => {
  const picks = [
    { gameKey: 'valorant-1', pick: 'Team Falcons' }, // 1st → 1000
    { gameKey: 'apex-2', pick: 'Team Liquid' }, // result missing → 0
  ];
  const results = [resultsFor()[0]]; // only valorant has a result
  const out = scorePerGameWeeklyPrediction(picks, GAMES, results);
  const apex = out.details.picks.find((p) => p.gameKey === 'apex-2');
  assert.equal(apex.points, 0);
  assert.equal(apex.resultAvailable, false);
  // Not all games are complete, so the all-winners bonus is withheld.
  assert.equal(out.details.allWinners, false);
  assert.equal(out.score, 1000);
});

test('scorePerGameWeeklyPrediction: an unknown club (no match in results) scores 0 for that game', () => {
  const picks = [
    { gameKey: 'valorant-1', pick: 'Nonexistent Club' },
    { gameKey: 'apex-2', pick: 'Team Liquid' }, // 1st → 1000
  ];
  const out = scorePerGameWeeklyPrediction(picks, GAMES, resultsFor());
  const valorant = out.details.picks.find((p) => p.gameKey === 'valorant-1');
  assert.equal(valorant.points, 0);
  assert.equal(valorant.matchedClub, null);
  assert.equal(out.score, 1000);
});

test('scorePerGameWeeklyPrediction: player participant aliases match solo-game club placements', () => {
  const games = [{ key: 'fatal-fury-1', game: 'Fatal Fury: City of the Wolves', event: 'EWC CotW' }];
  const results = [
    {
      gameKey: 'fatal-fury-1',
      placements: [
        { club: 'DetonatioN FocusMe', participant: 'GO1', points: 1000, place: '1st' },
        { club: 'Natus Vincere', participant: 'DarkAngel', points: 750, place: '2nd' },
      ],
    },
  ];

  const out = scorePerGameWeeklyPrediction([{ gameKey: 'fatal-fury-1', pick: 'GO1' }], games, results);
  const detail = out.details.picks[0];
  assert.equal(detail.points, 1000);
  assert.equal(detail.matchedClub, 'DetonatioN FocusMe');
  assert.equal(detail.participant, 'GO1');
});

test('scorePerGameWeeklyPrediction: a missing pick for a configured game scores 0, pick null', () => {
  const picks = [{ gameKey: 'valorant-1', pick: 'Team Falcons' }]; // no apex pick
  const out = scorePerGameWeeklyPrediction(picks, GAMES, resultsFor());
  const apex = out.details.picks.find((p) => p.gameKey === 'apex-2');
  assert.equal(apex.pick, null);
  assert.equal(apex.points, 0);
  assert.equal(out.score, 1000);
});

test('scorePerGameWeeklyPrediction: missing pick blocks the all-winners bonus even when results are available', () => {
  const picks = [{ gameKey: 'valorant-1', pick: 'Team Falcons' }];
  const out = scorePerGameWeeklyPrediction(picks, GAMES, resultsFor());
  const apex = out.details.picks.find((p) => p.gameKey === 'apex-2');
  assert.equal(apex.pick, null);
  assert.equal(apex.resultAvailable, true);
  assert.equal(out.details.allWinners, false);
  assert.equal(out.details.bonus, 0);
  assert.equal(out.score, 1000);
});

test('scorePerGameWeeklyPrediction: explicit pick timestamps enforce the game lock while legacy picks remain scoreable', () => {
  const game = [{ ...GAMES[0], lockAt: 500 }];
  const result = [resultsFor()[0]];
  const before = scorePerGameWeeklyPrediction([{ gameKey: 'valorant-1', pick: 'Team Falcons', pickedAt: 499 }], game, result);
  assert.equal(before.score, 1000);
  assert.equal(before.details.picks[0].late, false);

  const atLock = scorePerGameWeeklyPrediction([{ gameKey: 'valorant-1', pick: 'Team Falcons', pickedAt: 500 }], game, result);
  assert.equal(atLock.score, 0);
  assert.equal(atLock.details.picks[0].late, true);

  const afterLock = scorePerGameWeeklyPrediction([{ gameKey: 'valorant-1', pick: 'Team Falcons', pickedAt: 501 }], game, result);
  assert.equal(afterLock.score, 0);
  assert.equal(afterLock.details.picks[0].late, true);

  const legacy = scorePerGameWeeklyPrediction([{ gameKey: 'valorant-1', pick: 'Team Falcons' }], game, result);
  assert.equal(legacy.score, 1000);
  assert.equal(legacy.details.picks[0].late, false);
});

test('scorePerGameWeeklyPrediction: throws when the round has no per-game events configured', () => {
  assert.throws(() => scorePerGameWeeklyPrediction([], [], []), /no per-game events/);
});

test('pendingEwcGameResults: flags games whose results are absent or have no 1st-place club', () => {
  const results = [resultsFor()[0]]; // only valorant resolved
  const pending = pendingEwcGameResults(results, GAMES);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].gameKey, 'apex-2');
  // Both resolved → none pending.
  assert.equal(pendingEwcGameResults(resultsFor(), GAMES).length, 0);
});

test('perGamePredictionRoundLocked: closes only after every independent game lock', () => {
  const games = [{ lockAt: 1_000 }, { lockAt: 2_000 }];
  assert.equal(perGamePredictionRoundLocked(games, 1_999), false);
  assert.equal(perGamePredictionRoundLocked(games, 2_000), true);
  assert.equal(perGamePredictionRoundLocked([{ lockAt: 1_000 }, {}], 2_000), false);
  assert.equal(perGamePredictionRoundLocked([], 2_000), false);
});

test('dueEwcGamesForResults polls only unresolved events near their scheduled finish', () => {
  const games = [
    { ...GAMES[0], endAt: 10_000 },
    { ...GAMES[1], endAt: 30_000 },
  ];
  const due = dueEwcGamesForResults(games, [resultsFor()[0]], 20_000, 5_000);
  assert.deepEqual(due.map((game) => game.key), []);
  assert.deepEqual(dueEwcGamesForResults(games, [], 20_000, 15_000).map((game) => game.key), ['valorant-1', 'apex-2']);
});

test('mergeEwcGameResults preserves completed snapshots and upgrades pending ones', () => {
  const complete = resultsFor()[0];
  const pending = { gameKey: 'apex-2', placements: [], error: 'not final' };
  const merged = mergeEwcGameResults([complete, pending], [
    { gameKey: 'valorant-1', placements: [], error: 'transient' },
    resultsFor()[1],
  ]);
  assert.deepEqual(merged, resultsFor());
});

// ─── effectiveEwcWeekStatus (per-game lock-window state machine) ──────────────
//
// A per-game round carries games[] with a lockAt per game. Effective status is
// derived from round.status, open_at, close_at, and each game's lockAt vs now.

test('effectiveEwcWeekStatus: open round before its open_at reports "opens"', () => {
  const round = { status: 'open', open_at: 2000, close_at: 5000, games: [] };
  const state = effectiveEwcWeekStatus(round, 1000);
  assert.equal(state.label, 'opens');
  assert.equal(state.at, 2000);
});

test('effectiveEwcWeekStatus: per-game round with no games locked yet is "open"', () => {
  const round = { status: 'open', open_at: 0, games: [{ lockAt: 5000 }, { lockAt: 6000 }] };
  const state = effectiveEwcWeekStatus(round, 1000);
  assert.equal(state.label, 'open');
  assert.equal(state.lockedGames, 0);
  assert.equal(state.openGames, 2);
});

test('effectiveEwcWeekStatus: some games past lockAt → "partly open" with the open count', () => {
  const round = { status: 'open', open_at: 0, games: [{ lockAt: 1000 }, { lockAt: 9000 }] };
  const state = effectiveEwcWeekStatus(round, 5000); // first game locked, second still open
  assert.equal(state.label, 'partly open');
  assert.equal(state.lockedGames, 1);
  assert.equal(state.openGames, 1);
  assert.equal(state.totalGames, 2);
});

test('effectiveEwcWeekStatus: all games past lockAt → "locked"', () => {
  const round = { status: 'open', open_at: 0, games: [{ lockAt: 1000 }, { lockAt: 2000 }] };
  const state = effectiveEwcWeekStatus(round, 5000);
  assert.equal(state.label, 'locked');
  assert.equal(state.lockedGames, 2);
  assert.equal(state.openGames, 0);
});

test('effectiveEwcWeekStatus: aggregate round (no games) past close_at → "closed"', () => {
  const round = { status: 'open', open_at: 0, close_at: 3000, games: [] };
  assert.equal(effectiveEwcWeekStatus(round, 5000).label, 'closed');
  assert.equal(effectiveEwcWeekStatus(round, 1000).label, 'open');
});

test('effectiveEwcWeekStatus: scored round reports "scored"; missing round reports "missing"', () => {
  assert.equal(effectiveEwcWeekStatus({ status: 'scored', games: [] }).label, 'scored');
  assert.equal(effectiveEwcWeekStatus(null).label, 'missing');
});
