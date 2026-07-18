import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectSeasonScoreBreakdown,
  projectWeeklyScoreBreakdown,
} from '../src/lib/ewcPredictionBreakdown.js';
import { scorePerGameWeeklyPrediction, scoreSeasonPrediction, scoreWeeklyPrediction } from '../src/lib/ewcPredictions.js';

test('projects stored per-game details without recalculating points', () => {
  const scored = scorePerGameWeeklyPrediction(
    [
      { gameKey: 'valorant', pick: 'Team Falcons', pickedAt: 100 },
      { gameKey: 'apex', pick: 'Unknown Club', pickedAt: 100 },
      { gameKey: 'chess', pick: 'Late Club', pickedAt: 500 },
    ],
    [
      { key: 'valorant', game: 'Valorant', event: 'EWC Valorant', lockAt: 200 },
      { key: 'apex', game: 'Apex Legends', event: 'EWC ALGS', lockAt: 200 },
      { key: 'chess', game: 'Chess', event: 'EWC Chess', lockAt: 500 },
      { key: 'missing', game: 'Dota 2', event: 'EWC Dota', lockAt: 200 },
    ],
    [
      { gameKey: 'valorant', placements: [{ club: 'Team Falcons', place: '1st', points: 1000 }] },
      { gameKey: 'apex', placements: [{ club: 'Other Club', place: '1st', points: 1000 }] },
      { gameKey: 'chess', placements: [{ club: 'Late Club', place: '1st', points: 1000 }] },
      { gameKey: 'missing', placements: [{ club: 'Nobody', place: '1st', points: 1000 }] },
    ],
  );
  const breakdown = projectWeeklyScoreBreakdown({ score: scored.score, details: scored.details });

  assert.equal(breakdown.available, true);
  assert.equal(breakdown.kind, 'weekly-per-game');
  assert.equal(breakdown.integrity, 'ok');
  assert.deepEqual(breakdown.rows.map((row) => row.status), ['scored', 'unmatched', 'late', 'missed']);
  assert.equal(breakdown.rows[0].placement, '1st');
  assert.equal(breakdown.rows[0].winner, 'Team Falcons');
  assert.equal(breakdown.rows[0].points, 1000);
  assert.equal(breakdown.total, scored.score);
});

test('projects aggregate weekly and season details with stored bonuses intact', () => {
  const legacy = scoreWeeklyPrediction(
    ['Falcons', 'T1', 'Unknown'],
    [
      { team: 'Falcons', rank: 1, points: 100 },
      { team: 'T1', rank: 2, points: 80 },
    ],
    [
      { team: 'Falcons', rank: 1, points: 160 },
      { team: 'T1', rank: 2, points: 120 },
    ],
  );
  const weekly = projectWeeklyScoreBreakdown({ score: legacy.score, details: legacy.details });
  assert.equal(weekly.kind, 'weekly-aggregate');
  assert.equal(weekly.rows[0].weeklyRank, 1);
  assert.equal(weekly.rows[2].status, 'unmatched');
  assert.equal(weekly.bonus, legacy.details.bonus);
  assert.equal(weekly.integrity, 'ok');

  const season = scoreSeasonPrediction(
    ['Team1', 'Team11', 'Team3'],
    Array.from({ length: 10 }, (_, index) => ({ team: `Team${index + 1}`, rank: index + 1, points: 1000 - index * 100 })),
    10,
  );
  const seasonBreakdown = projectSeasonScoreBreakdown({ score: season.score, details: season.details });
  assert.equal(seasonBreakdown.kind, 'season');
  assert.equal(seasonBreakdown.rows[0].predictedRank, 1);
  assert.equal(seasonBreakdown.rows[0].exactBonus, 250);
  assert.equal(seasonBreakdown.rows[1].status, 'unmatched');
  assert.equal(seasonBreakdown.integrity, 'ok');
});

test('handles malformed historical details and visibly detects stored-total mismatches', () => {
  assert.equal(projectWeeklyScoreBreakdown({ score: null, details: { picks: [] } }), null);
  assert.deepEqual(projectWeeklyScoreBreakdown({ score: 100, details: null }), {
    available: false,
    kind: 'weekly',
    total: 100,
    bonus: 0,
    rows: [],
    integrity: 'unavailable',
  });

  const mismatch = projectSeasonScoreBreakdown({
    score: 900,
    details: { picks: [{ pick: 'Team Falcons', matchedTeam: 'Team Falcons', predictedRank: 1, actualRank: 1, hitPoints: 500, exactBonus: 0, points: 500 }] },
  });
  assert.equal(mismatch.integrity, 'mismatch');
  assert.equal(mismatch.total, 900);
  assert.equal(mismatch.rows[0].points, 500);
});

test('distinguishes a pending game result from a failed club match', () => {
  const breakdown = projectWeeklyScoreBreakdown({
    score: 0,
    details: {
      mode: 'per-game',
      picks: [{
        gameKey: 'league-of-legends',
        game: 'League of Legends',
        event: 'EWC 2026',
        pick: 'Hanwha Life Esports',
        matchedClub: null,
        points: 0,
        resultAvailable: false,
      }],
    },
  });

  assert.equal(breakdown.rows[0].status, 'pending');
  assert.equal(breakdown.rows[0].resultAvailable, false);
  assert.equal(breakdown.integrity, 'ok');
});
