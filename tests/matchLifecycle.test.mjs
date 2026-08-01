import assert from 'node:assert/strict';
import test from 'node:test';

const {
  inferWinnerSideFromScores,
  mergeMatchLifecycle,
  normalizeMatchLifecycle,
  winnerSideFromWinnerName,
} = await import('../src/lib/matchLifecycle.js');

test('normalizes scoreless explicit winners without inventing a score result', () => {
  assert.deepEqual(
    normalizeMatchLifecycle({
      status: 'finished',
      winner: 'Alpha',
      team_a: 'Alpha',
      team_b: 'Beta',
      score_a: null,
      score_b: null,
    }),
    {
      status: 'finished',
      winner_side: 'team1',
      result_reason: 'unknown',
      status_known: true,
    },
  );
});

test('explicit winner evidence takes precedence over conflicting scores', () => {
  assert.equal(winnerSideFromWinnerName('Beta', 'Alpha', 'Beta'), 'team2');
  assert.equal(inferWinnerSideFromScores(3, 1), 'team1');
  assert.equal(
    normalizeMatchLifecycle({
      status: 'finished',
      winner: 'Beta',
      team_a: 'Alpha',
      team_b: 'Beta',
      score_a: 3,
      score_b: 1,
    }).winner_side,
    'team2',
  );
});

test('unknown upstream status preserves a trusted running state', () => {
  const merged = mergeMatchLifecycle(
    {
      status: 'running',
      winner_side: null,
      result_reason: 'unknown',
      scheduled_at: 100,
    },
    {
      status: null,
      winner_side: null,
      result_reason: 'unknown',
      scheduled_at: 100,
    },
  );

  assert.equal(merged.status, 'running');
  assert.equal(merged.status_accepted, false);
});

test('finished and cancelled matches cannot regress to active states', () => {
  for (const terminal of ['finished', 'cancelled']) {
    const merged = mergeMatchLifecycle(
      {
        status: terminal,
        winner_side: terminal === 'finished' ? 'team1' : null,
        result_reason: terminal === 'finished' ? 'normal' : 'cancelled',
        scheduled_at: 100,
      },
      {
        status: 'running',
        winner_side: null,
        result_reason: 'unknown',
        scheduled_at: 100,
      },
    );

    assert.equal(merged.status, terminal);
    assert.equal(merged.status_accepted, false);
  }
});

test('an explicit authoritative correction can reopen a falsely finished match', () => {
  const merged = mergeMatchLifecycle(
    {
      status: 'finished',
      winner_side: 'team1',
      result_reason: 'normal',
      scheduled_at: 100,
    },
    {
      status: 'running',
      score_a: 2,
      score_b: 0,
      scheduled_at: 100,
    },
    { allowTerminalCorrection: true },
  );

  assert.equal(merged.status, 'running');
  assert.equal(merged.winner_side, null);
  assert.equal(merged.status_accepted, true);
});

test('postponed matches reopen only with a changed schedule', () => {
  const existing = {
    status: 'postponed',
    winner_side: null,
    result_reason: 'postponed',
    scheduled_at: 100,
  };

  assert.equal(
    mergeMatchLifecycle(existing, {
      status: 'scheduled',
      scheduled_at: 100,
    }).status,
    'postponed',
  );
  const rescheduled = mergeMatchLifecycle(existing, {
    status: 'scheduled',
    scheduled_at: 200,
  });
  assert.equal(rescheduled.status, 'scheduled');
  assert.equal(rescheduled.status_accepted, true);
});

test('cancellation and postponement clear stale outcome evidence', () => {
  for (const status of ['cancelled', 'postponed']) {
    const merged = mergeMatchLifecycle(
      {
        status: 'running',
        winner_side: 'team1',
        result_reason: 'normal',
        scheduled_at: 100,
      },
      {
        status,
        winner_side: 'team2',
        result_reason: 'normal',
        scheduled_at: 100,
      },
    );

    assert.equal(merged.status, status);
    assert.equal(merged.winner_side, null);
    assert.equal(merged.result_reason, status);
  }
});

test('supports the complete scheduled-to-finished lifecycle', () => {
  let state = normalizeMatchLifecycle({ status: 'scheduled', scheduled_at: 100 });
  state = mergeMatchLifecycle(state, { status: 'postponed', scheduled_at: 100 });
  assert.equal(state.status, 'postponed');
  state = mergeMatchLifecycle({ ...state, scheduled_at: 100 }, { status: 'scheduled', scheduled_at: 200 });
  assert.equal(state.status, 'scheduled');
  state = mergeMatchLifecycle({ ...state, scheduled_at: 200 }, { status: 'running', scheduled_at: 200 });
  assert.equal(state.status, 'running');
  state = mergeMatchLifecycle(
    { ...state, scheduled_at: 200 },
    {
      status: 'finished',
      winner_side: 'team2',
      result_reason: 'normal',
      scheduled_at: 200,
    },
  );
  assert.equal(state.status, 'finished');
  assert.equal(state.winner_side, 'team2');
  assert.equal(state.result_reason, 'normal');
});
