import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.DB_DRIVER = 'sqlite';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.LOG_LEVEL = 'error';
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch, toMatchRow, getMatch } = await import('../src/db/matches.js');
const { armMatch, pollMatch, stopAll, activeCount, setUpdateHandler } = await import('../src/jobs/pollingManager.js');

let sequence = 0;
async function fixture() {
  const tournament = await addTournament({ source: 'liquipedia', external_id: `poll-${++sequence}`, game: 'mobilelegends', guild_id: 'test' });
  const parsed = [1, 2].map(i => ({ source: 'liquipedia', externalId: `poll-${sequence}-${i}`, teamA: `Team ${i}A`, teamB: `Team ${i}B`, status: 'running', scheduledAt: Math.floor(Date.now() / 1000) - 60, scoreA: 0, scoreB: 0 }));
  const matches = [];
  for (const row of parsed) {
    const match = await upsertMatch(toMatchRow(row, tournament.id));
    matches.push(match);
    armMatch(match, tournament, { initialPollDelayMs: 60_000 });
  }
  return { tournament, parsed, matches };
}
test.afterEach(() => { stopAll(); setUpdateHandler(null); });

test('150 overlapping ticks share one tournament pass and retire both finished watchers', async () => {
  const { tournament, parsed, matches } = await fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let fetches = 0;
  const events = [];
  setUpdateHandler((type, row) => events.push([type, row.id]));
  const fetchSchedule = async () => { fetches++; await gate; return parsed.map(row => ({ ...row, status: 'finished', scoreA: 2, scoreB: 1 })); };
  const attempts = Array.from({ length: 150 }, (_, i) => pollMatch(matches[i % 2], tournament, { fetchSchedule }));
  release();
  await Promise.all(attempts);
  assert.equal(fetches, 1);
  assert.equal(events.filter(([type]) => type === 'finished').length, 2);
  assert.equal(activeCount(), 0);
  for (const match of matches) assert.equal((await getMatch(match.source, match.external_id)).status, 'finished');
});

test('failed polls release the tournament slot so the next interval can retry', async () => {
  const { tournament, parsed, matches } = await fixture();
  await assert.rejects(pollMatch(matches[0], tournament, { fetchSchedule: async () => { throw new Error('provider timeout'); } }), /provider timeout/);
  let fetched = false;
  await pollMatch(matches[1], tournament, { fetchSchedule: async () => { fetched = true; return parsed; } });
  assert.equal(fetched, true);
});

test('stopping watchers while queued discards the result without rearming matches', async () => {
  const { tournament, parsed, matches } = await fixture();
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const job = pollMatch(matches[0], tournament, { fetchSchedule: async () => { entered(); await gate; return parsed.map(row => ({ ...row, status: 'finished', scoreA: 2, scoreB: 0 })); } });
  await started;
  stopAll();
  release();
  await job;
  assert.equal(activeCount(), 0);
  assert.equal((await getMatch(matches[0].source, matches[0].external_id)).status, 'running');
});

test('a blocked tournament does not block another tournament', async () => {
  const first = await fixture();
  const second = await fixture();
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const pending = pollMatch(first.matches[0], first.tournament, { fetchSchedule: async () => {
    entered(); await gate; return first.parsed;
  } });
  await started;
  try {
    await pollMatch(second.matches[0], second.tournament, { fetchSchedule: async () =>
      second.parsed.map(row => ({ ...row, status: 'finished', scoreA: 2, scoreB: 0 })) });
    assert.equal(activeCount(), 2);
    assert.equal((await getMatch(second.matches[1].source, second.matches[1].external_id)).status, 'finished');
  } finally {
    release(); await pending;
  }
});

test('a remaining live watcher can refresh after its sibling finishes', async () => {
  const { tournament, parsed, matches } = await fixture();
  await pollMatch(matches[0], tournament, { fetchSchedule: async () => [
    { ...parsed[0], status: 'finished', scoreA: 2, scoreB: 0 }, parsed[1],
  ] });
  assert.equal(activeCount(), 1);
  await pollMatch(matches[1], tournament, { fetchSchedule: async () =>
    parsed.map(row => ({ ...row, status: 'finished', scoreA: 2, scoreB: 0 })) });
  assert.equal(activeCount(), 0);
  assert.equal((await getMatch(matches[1].source, matches[1].external_id)).status, 'finished');
});
