import assert from 'node:assert/strict';
import test from 'node:test';

// config.js exits the process on missing required vars, and the token guard
// short-circuits fetchSchedule/resolveTournamentTitle when unset — config reads
// env at import time, so set everything BEFORE importing the module.
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.STARTGG_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';

const { fetchSchedule, resolveTournamentTitle, normalizeSet, query, startggClient, RECENT_WINDOW } = await import(
  '../src/services/startgg.js'
);

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

test('fetchSchedule caps a huge event at the RECENT window (no paging into 22k qualifiers)', async () => {
  const sets = Array.from({ length: 1000 }, (_, i) => buildSet(i + 1));
  const q = makeQuery({ events: [{ id: 'E1', name: 'Main' }], setsByEvent: { E1: sets } });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(matches.length, RECENT_WINDOW, 'stops at the bounded window, not the full event');
  // ceil(RECENT_WINDOW / 50) pages, no deeper.
  assert.equal(q.eventCalls().length, Math.ceil(RECENT_WINDOW / 50));
  assert.deepEqual(
    q.eventCalls().map((c) => c.vars.page),
    [1, 2, 3],
  );
});

test('fetchSchedule returns ALL sets of a small event (Swiss/finals fit under the window)', async () => {
  const sets = Array.from({ length: 20 }, (_, i) => buildSet(i + 1));
  const q = makeQuery({ events: [{ id: 'E1', name: 'Finals' }], setsByEvent: { E1: sets } });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(matches.length, 20, 'a small event is returned in full');
  assert.equal(q.eventCalls().length, 1, 'one page is enough');
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
  assert.ok(perPages.includes(25), 'retried at the smaller page size');
});

test('fetchSchedule accepts a slug that is already a full tournament path', async () => {
  const q = makeQuery({ events: [{ id: 'E1', name: 'Main' }], setsByEvent: { E1: [buildSet(1)] } });
  await fetchSchedule({ external_id: 'tournament/already-pathed', name: 'x' }, { query: q });
  const head = q.calls.find((c) => /tournament\(slug/.test(c.gql));
  assert.equal(head.vars.slug, 'tournament/already-pathed', 'an existing path is not double-prefixed');
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

// The network-layer query() retries TRANSIENT failures (timeouts + start.gg's generic
// "An unknown error has occurred") but not deterministic GraphQL errors. Stub the
// exported axios client's `post` so no request leaves the box; delayMs:0 skips backoff.
function stubPost(fn) {
  const original = startggClient.post;
  startggClient.post = fn;
  return () => {
    startggClient.post = original;
  };
}

function timeoutError() {
  const e = new Error('timeout of 25000ms exceeded');
  e.code = 'ECONNABORTED';
  return e;
}

test('query retries once on timeout, then succeeds', async () => {
  let calls = 0;
  const restore = stubPost(async () => {
    calls += 1;
    if (calls === 1) throw timeoutError();
    return { data: { data: { ok: true } } };
  });
  try {
    assert.deepEqual(await query('{ x }', {}, { delayMs: 0 }), { ok: true });
    assert.equal(calls, 2, 'one timeout then one success');
  } finally {
    restore();
  }
});

test('query retries start.gg\'s generic "An unknown error has occurred"', async () => {
  let calls = 0;
  const restore = stubPost(async () => {
    calls += 1;
    if (calls === 1) return { data: { errors: [{ message: 'An unknown error has occurred' }] } };
    return { data: { data: { ok: true } } };
  });
  try {
    assert.deepEqual(await query('{ x }', {}, { delayMs: 0 }), { ok: true });
    assert.equal(calls, 2, 'the generic transient error is retried');
  } finally {
    restore();
  }
});

test('query gives up after exhausting retries', async () => {
  let calls = 0;
  const restore = stubPost(async () => {
    calls += 1;
    throw timeoutError();
  });
  try {
    await assert.rejects(() => query('{ x }', {}, { retries: 3, delayMs: 0 }), /timeout/i);
    assert.equal(calls, 3, 'tried three times, no more');
  } finally {
    restore();
  }
});

test('query does NOT retry deterministic GraphQL errors (complexity)', async () => {
  let calls = 0;
  const restore = stubPost(async () => {
    calls += 1;
    return { data: { errors: [{ message: 'query complexity is too high' }] } };
  });
  try {
    await assert.rejects(() => query('{ x }', {}, { delayMs: 0 }), /complexity/i);
    assert.equal(calls, 1, 'complexity errors surface immediately');
  } finally {
    restore();
  }
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
