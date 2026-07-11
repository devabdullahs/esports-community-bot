import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { persistFetchedStandings } = await import('../src/jobs/pollingManager.js');

test('live polling persists standings attached to an existing schedule response', async () => {
  const matches = [];
  Object.defineProperty(matches, 'standings', {
    value: {
      hadRows: true,
      sections: [{ title: 'Finals: Grand Final', entries: [{ rank: 1, team: 'Wolves Esports', points: '38' }] }],
    },
  });
  const calls = [];
  const rows = await persistFetchedStandings(matches, 24, {
    replace: async (...args) => {
      calls.push(args);
      return 20;
    },
  });
  assert.equal(rows, 20);
  assert.deepEqual(calls, [[24, matches.standings.sections]]);
});

test('live polling preserves stored standings when no standings DOM was parsed', async () => {
  const calls = [];
  assert.equal(await persistFetchedStandings([], 24, { replace: async (...args) => calls.push(args) }), 0);
  assert.deepEqual(calls, []);
});
