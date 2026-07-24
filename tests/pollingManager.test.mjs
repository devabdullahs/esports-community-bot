import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.NODE_ENV = 'test';
process.env.STARTGG_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';

const { activeCount, armMatch, maxAbsentRunSeconds, shouldRetireAbsentMatch, stopAll } = await import(
  '../src/jobs/pollingManager.js'
);

function startggMatch(externalId) {
  return {
    source: 'startgg',
    external_id: externalId,
    tournament_id: 1,
    team_a: 'Player A',
    team_b: 'Player B',
    status: 'scheduled',
    scheduled_at: Math.floor(Date.now() / 1000) + 3600,
  };
}

test('armMatch skips projected start.gg preview rows but arms real set ids', (t) => {
  t.after(() => stopAll());
  stopAll();

  assert.equal(armMatch(startggMatch('sgg:preview_3348077_2_1'), { id: 1, source: 'startgg' }), false);
  assert.equal(activeCount(), 0);

  assert.equal(armMatch(startggMatch('sgg:104353062'), { id: 1, source: 'startgg' }), true);
  assert.equal(activeCount(), 1);
});

test('armMatch arms Liquipedia battle-royale schedule rows', (t) => {
  t.after(() => stopAll());
  stopAll();

  assert.equal(
    armMatch(
      {
        source: 'liquipedia',
        external_id: 'apexlegends:br-schedule:group-stage:a-vs-b:game-6',
        tournament_id: 1,
        team_a: 'Group Stage - A vs B - Game 6',
        team_b: 'Lobby',
        status: 'scheduled',
        scheduled_at: Math.floor(Date.now() / 1000) + 3600,
      },
      { id: 1, source: 'liquipedia' },
    ),
    true,
  );
  assert.equal(activeCount(), 1);
});

test('armMatch can delay the first poll for resumed live rows', (t) => {
  t.after(() => stopAll());
  stopAll();

  const match = startggMatch('sgg:104353063');
  match.status = 'running';
  match.scheduled_at = Math.floor(Date.now() / 1000) - 60;

  assert.equal(armMatch(match, { id: 1, source: 'startgg' }, { initialPollDelayMs: 60_000 }), true);
  assert.equal(activeCount(), 1);
});

test('absent EA FC matches retire sooner without changing the default safety net', () => {
  assert.equal(maxAbsentRunSeconds({ game: 'easportsfc' }), 3 * 3600);
  assert.equal(maxAbsentRunSeconds({ game: 'dota2' }), 8 * 3600);
  assert.equal(maxAbsentRunSeconds(null), 8 * 3600);

  const scheduledAt = 1_000_000;
  const match = { scheduled_at: scheduledAt };
  assert.equal(shouldRetireAbsentMatch(match, { game: 'easportsfc' }, scheduledAt + 3 * 3600), false);
  assert.equal(shouldRetireAbsentMatch(match, { game: 'easportsfc' }, scheduledAt + 3 * 3600 + 1), true);
  assert.equal(shouldRetireAbsentMatch(match, { game: 'dota2' }, scheduledAt + 3 * 3600 + 1), false);
  assert.equal(shouldRetireAbsentMatch({}, { game: 'easportsfc' }, scheduledAt + 9 * 3600), false);
});
