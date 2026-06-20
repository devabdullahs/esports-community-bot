import assert from 'node:assert/strict';
import test from 'node:test';

// The token guard short-circuits fetchSchedule/resolveTournamentTitle when unset,
// and config reads env at import time — so set it BEFORE importing the module.
process.env.STARTGG_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';

const { fetchSchedule, resolveTournamentTitle, normalizeSet } = await import('../src/services/startgg.js');

// Build a set node in start.gg's shape. Unique id → unique externalId (`sgg:<id>`).
function buildSet(id, { winner = false, state = 3, scoreA = winner ? 3 : 0, scoreB = winner ? 1 : 0 } = {}) {
  return {
    id,
    state,
    startAt: 1000 + id,
    winnerId: winner ? id * 10 + 1 : null,
    slots: [
      { entrant: { id: id * 10 + 1, name: `A${id}` }, standing: { stats: { score: { value: scoreA } } } },
      { entrant: { id: id * 10 + 2, name: `B${id}` }, standing: { stats: { score: { value: scoreB } } } },
    ],
  };
}

// A fake injected `query`: serves the HEAD query (tournament name + events) and the
// per-event paginated sets query, computing totalPages from the page size like the
// real API. `complexityAbove` makes it throw a complexity error for larger pages so
// the retry ladder is exercised. Records every call for assertions. No network.
function makeQuery({ name = 'Real Tournament', events = [], setsByEvent = {}, complexityAbove = Infinity } = {}) {
  const q = async (gql, vars) => {
    q.calls.push({ gql, vars });
    if (/tournament\(slug/.test(gql)) {
      return { tournament: { name, events } };
    }
    if (/event\(id/.test(gql)) {
      const { eventId, page, perPage } = vars;
      if (perPage > complexityAbove) throw new Error('Your query complexity is too high (1500). Maximum is 1000.');
      const all = setsByEvent[eventId] ?? [];
      const totalPages = Math.max(1, Math.ceil(all.length / perPage));
      const start = (page - 1) * perPage;
      return { event: { sets: { pageInfo: { totalPages }, nodes: all.slice(start, start + perPage) } } };
    }
    throw new Error(`unexpected query: ${gql.slice(0, 40)}`);
  };
  q.calls = [];
  q.eventCalls = () => q.calls.filter((c) => /event\(id/.test(c.gql));
  return q;
}

const tournament = { external_id: 'rlcs-2026-mena-1v1-open', name: 'rlcs-2026-mena-1v1-open' };

test('fetchSchedule paginates past page 1 — captures a 150-match event (the old 40-cap bug)', async () => {
  const sets = Array.from({ length: 150 }, (_, i) => buildSet(i + 1));
  const q = makeQuery({ events: [{ id: 'E1', name: 'Main' }], setsByEvent: { E1: sets } });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(matches.length, 150, 'every match across all pages is returned, not just the first 40');
  // 1 HEAD call + ceil(150/50)=3 event-page calls.
  assert.equal(q.eventCalls().length, 3, 'walked all three pages');
  assert.deepEqual(
    q.eventCalls().map((c) => c.vars.page),
    [1, 2, 3],
  );
});

test('fetchSchedule spans every event and dedupes overlapping set ids', async () => {
  const e1 = Array.from({ length: 30 }, (_, i) => buildSet(i + 1)); // ids 1..30
  const e2 = Array.from({ length: 30 }, (_, i) => buildSet(i + 1)); // ids 1..30 (full overlap)
  const q = makeQuery({
    events: [
      { id: 'E1', name: 'Bracket A' },
      { id: 'E2', name: 'Bracket B' },
    ],
    setsByEvent: { E1: e1, E2: e2 },
  });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(matches.length, 30, 'overlapping externalIds across events are deduped');
  const ids = new Set(matches.map((m) => m.externalId));
  assert.equal(ids.size, 30);
  // Both events were queried (one page each at 30 <= perPage 50).
  assert.deepEqual(new Set(q.eventCalls().map((c) => c.vars.eventId)), new Set(['E1', 'E2']));
});

test('fetchSchedule retries the whole event at a smaller page size on a complexity error', async () => {
  const sets = Array.from({ length: 60 }, (_, i) => buildSet(i + 1));
  // Pages > 25 are rejected as too complex; the ladder drops 50 → 25 and restarts at page 1.
  const q = makeQuery({ events: [{ id: 'E1', name: 'Main' }], setsByEvent: { E1: sets }, complexityAbove: 25 });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(matches.length, 60, 'all matches still collected after the retry');
  const perPages = q.eventCalls().map((c) => c.vars.perPage);
  assert.ok(perPages.includes(50), 'attempted the large page size first');
  assert.ok(
    perPages.filter((p) => p === 25).length >= 1,
    'retried at the smaller page size',
  );
});

test('fetchSchedule bounds runaway events at the page cap', async () => {
  // 1600 sets / 50 per page = 32 pages, but MAX_PAGES_PER_EVENT caps the walk at 30.
  const sets = Array.from({ length: 1600 }, (_, i) => buildSet(i + 1));
  const q = makeQuery({ events: [{ id: 'E1', name: 'Huge' }], setsByEvent: { E1: sets } });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(q.eventCalls().length, 30, 'stops at the 30-page cap');
  assert.equal(matches.length, 30 * 50, 'collects only the capped pages');
});

test('resolveTournamentTitle returns the real name, null on error or blank', async () => {
  const ok = makeQuery({ name: 'RLCS 2026 MENA 1v1 Open', events: [] });
  assert.equal(await resolveTournamentTitle(tournament, { query: ok }), 'RLCS 2026 MENA 1v1 Open');

  const blank = makeQuery({ name: '   ', events: [] });
  assert.equal(await resolveTournamentTitle(tournament, { query: blank }), null);

  const throws = async () => {
    throw new Error('boom');
  };
  assert.equal(await resolveTournamentTitle(tournament, { query: throws }), null);
});

test('fetchSchedule accepts a slug that is already a full tournament path', async () => {
  const q = makeQuery({ events: [{ id: 'E1', name: 'Main' }], setsByEvent: { E1: [buildSet(1)] } });
  await fetchSchedule({ external_id: 'tournament/already-pathed', name: 'x' }, { query: q });
  const head = q.calls.find((c) => /tournament\(slug/.test(c.gql));
  assert.equal(head.vars.slug, 'tournament/already-pathed', 'an existing path is not double-prefixed');
});

test('normalizeSet maps status, scores, and winner', () => {
  const finished = normalizeSet(buildSet(7, { winner: true }));
  assert.equal(finished.status, 'finished');
  assert.equal(finished.winner, 'A7', 'winnerId matching slot A resolves to teamA');
  assert.equal(finished.scoreA, 3);
  assert.equal(finished.scoreB, 1);
  assert.equal(finished.externalId, 'sgg:7');
  assert.equal(finished.source, 'startgg');

  const running = normalizeSet(buildSet(8, { state: 2 }));
  assert.equal(running.status, 'running');
  assert.equal(running.winner, null);

  const scheduled = normalizeSet(buildSet(9, { state: 1 }));
  assert.equal(scheduled.status, 'scheduled');
});

test('normalizeSet treats negative scores as null and drops fully-TBD sets', () => {
  const negative = normalizeSet(buildSet(10, { scoreA: -1, scoreB: -1 }));
  assert.equal(negative.scoreA, null, 'a -1 placeholder score is normalized to null');
  assert.equal(negative.scoreB, null);

  const bothTbd = normalizeSet({
    id: 11,
    state: 1,
    winnerId: null,
    slots: [{ entrant: null }, { entrant: null }],
  });
  assert.equal(bothTbd, null, 'a set with no entrants on either side is dropped');

  const oneTbd = normalizeSet({
    id: 12,
    state: 1,
    winnerId: null,
    slots: [{ entrant: { id: 1, name: 'Seed 1' } }, { entrant: null }],
  });
  assert.ok(oneTbd, 'a partially-seeded set is kept');
  assert.equal(oneTbd.teamB, 'TBD');
});
