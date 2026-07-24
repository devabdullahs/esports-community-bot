import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.NODE_ENV = 'test';
process.env.PANDASCORE_TOKEN = 'test-token';
process.env.STARTGG_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';

const {
  normalizeMatch: normalizePandaScoreMatch,
  normalizePandaScoreStatus,
} = await import('../src/services/pandascore.js');
const {
  normalizeSet,
  normalizeStartggState,
} = await import('../src/services/startgg.js');

function pandaMatch(status) {
  return {
    id: 101,
    status,
    opponents: [
      { opponent: { id: 1, name: 'Alpha' } },
      { opponent: { id: 2, name: 'Bravo' } },
    ],
    results: [],
  };
}

test('PandaScore maps only known lifecycle states', () => {
  assert.equal(normalizePandaScoreStatus('not_started'), 'scheduled');
  assert.equal(normalizePandaScoreStatus('running'), 'running');
  assert.equal(normalizePandaScoreStatus('finished'), 'finished');
  assert.equal(normalizePandaScoreStatus('postponed'), 'postponed');
  assert.equal(normalizePandaScoreStatus('canceled'), 'cancelled');
  assert.equal(normalizePandaScoreStatus('provider_added_new_state'), null);
  assert.equal(normalizePandaScoreMatch(pandaMatch('provider_added_new_state')).status, null);
});

test('start.gg maps states explicitly and preserves completed sets without a winner', () => {
  assert.equal(normalizeStartggState(1), 'scheduled');
  assert.equal(normalizeStartggState(2), 'running');
  assert.equal(normalizeStartggState(3), 'finished');
  assert.equal(normalizeStartggState(99), null);

  const match = normalizeSet({
    id: 55,
    state: 3,
    winnerId: null,
    slots: [
      { entrant: { id: 1, name: 'Alpha' }, standing: { stats: { score: { value: 1 } } } },
      { entrant: { id: 2, name: 'Bravo' }, standing: { stats: { score: { value: 1 } } } },
    ],
  });
  assert.equal(match.status, 'finished');
  assert.equal(match.winner, null);
});
