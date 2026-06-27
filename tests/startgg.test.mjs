import assert from 'node:assert/strict';
import test from 'node:test';

// config.js exits the process on missing required vars, and the token guard
// short-circuits the resolvers when unset — config reads env at import time, so
// set everything BEFORE importing the module.
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.STARTGG_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';

const {
  fetchSchedule,
  fetchMatch,
  resolveTournamentTitle,
  resolveTournamentGame,
  normalizeSet,
  query,
  startggClient,
  STATE_WINDOWS,
} = await import('../src/services/startgg.js');

const capFor = (state) => STATE_WINDOWS.find((w) => w.state === state).cap;

// Build a set node in start.gg's shape. state 3 = completed (has a winner), 2 = in
// progress, 1 = not started. Unique id → unique externalId (`sgg:<id>`).
function buildSet(id, { state = 3, scoreA, scoreB } = {}) {
  const finished = state === 3;
  const sA = scoreA ?? (finished ? 3 : 0);
  const sB = scoreB ?? (finished ? 1 : 0);
  return {
    id,
    state,
    startAt: null,
    winnerId: finished ? id * 10 + 1 : null,
    slots: [
      { entrant: { id: id * 10 + 1, name: `A${id}` }, standing: { stats: { score: { value: sA } } } },
      { entrant: { id: id * 10 + 2, name: `B${id}` }, standing: { stats: { score: { value: sB } } } },
    ],
  };
}

function makeSets(state, startId, count) {
  return Array.from({ length: count }, (_, i) => buildSet(startId + i, { state }));
}

// A fake injected `query`: serves the HEAD query (name + events + videogame) and the
// per-event sets query, FILTERING by the requested lifecycle state and computing
// totalPages from the page size like the real API. `complexityAbove` throws a
// complexity error for larger pages so the retry ladder is exercised. No network.
function makeQuery({
  name = 'Real Tournament',
  eventName = null,
  events = [],
  setsByEvent = {},
  videogame = null,
  complexityAbove = Infinity,
} = {}) {
  const q = async (gql, vars) => {
    q.calls.push({ gql, vars });
    if (/event\(slug/.test(gql)) {
      return {
        event: {
          id: events[0]?.id ?? 'E1',
          name: eventName ?? events[0]?.name ?? 'Main Event',
          videogame: videogame ? { name: videogame } : (events[0]?.videogame ?? null),
          tournament: { name },
        },
      };
    }
    if (/tournament\(slug/.test(gql)) {
      const evs = events.map((e) => ({ ...e, videogame: videogame ? { name: videogame } : null }));
      return { tournament: { name, events: evs } };
    }
    if (/event\(id/.test(gql)) {
      const { eventId, page, perPage, state } = vars;
      if (perPage > complexityAbove) throw new Error('Your query complexity is too high (1500). Maximum is 1000.');
      let all = setsByEvent[eventId] ?? [];
      if (Array.isArray(state)) all = all.filter((s) => state.includes(s.state));
      const totalPages = Math.max(1, Math.ceil(all.length / perPage));
      const start = (page - 1) * perPage;
      return { event: { sets: { pageInfo: { totalPages }, nodes: all.slice(start, start + perPage) } } };
    }
    throw new Error(`unexpected query: ${gql.slice(0, 40)}`);
  };
  q.calls = [];
  q.eventCalls = () => q.calls.filter((c) => /event\(id/.test(c.gql));
  q.eventHeadCalls = () => q.calls.filter((c) => /event\(slug/.test(c.gql));
  q.tournamentHeadCalls = () => q.calls.filter((c) => /tournament\(slug/.test(c.gql));
  return q;
}

function statusCounts(matches) {
  return matches.reduce((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});
}

const tournament = { external_id: 'rlcs-2026-na-1v1-open', name: 'rlcs-2026-na-1v1-open' };

test('fetchSchedule returns live + upcoming + recent results — NOT just the finished ones', async () => {
  // A LIVE event: lots of each state. The bug this guards: RECENT-only sorting returned
  // finished-dominated windows, so the boards' live/upcoming views stayed empty.
  const sets = [
    ...makeSets(2, 1, 200), // active
    ...makeSets(1, 1001, 200), // upcoming
    ...makeSets(3, 2001, 200), // done
  ];
  const q = makeQuery({ events: [{ id: 'E1', name: '1v1 Open' }], setsByEvent: { E1: sets } });

  const matches = await fetchSchedule(tournament, { query: q });
  const counts = statusCounts(matches);

  assert.equal(counts.running, capFor(2), 'live matches captured up to their cap');
  assert.equal(counts.scheduled, capFor(1), 'upcoming matches captured up to their cap');
  assert.equal(counts.finished, capFor(3), 'recent results captured up to their (smaller) cap');
  assert.ok(counts.running > 0 && counts.scheduled > 0, 'the board-facing live/upcoming matches are present');
  // Every window state was queried.
  assert.deepEqual(
    new Set(q.eventCalls().flatMap((c) => c.vars.state)),
    new Set([1, 2, 3]),
  );
});

test('fetchSchedule returns ALL sets of a small event across states', async () => {
  const sets = [...makeSets(2, 1, 5), ...makeSets(1, 101, 5), ...makeSets(3, 201, 5)];
  const q = makeQuery({ events: [{ id: 'E1', name: 'Finals' }], setsByEvent: { E1: sets } });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.deepEqual(statusCounts(matches), { running: 5, scheduled: 5, finished: 5 });
});

test('fetchSchedule spans every event and dedupes overlapping set ids', async () => {
  const e1 = makeSets(2, 1, 10); // ids 1..10
  const e2 = makeSets(2, 1, 10); // ids 1..10 (full overlap)
  const q = makeQuery({
    events: [
      { id: 'E1', name: 'A' },
      { id: 'E2', name: 'B' },
    ],
    setsByEvent: { E1: e1, E2: e2 },
  });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(matches.length, 10, 'overlapping externalIds across events are deduped');
  assert.deepEqual(new Set(q.eventCalls().map((c) => c.vars.eventId)), new Set(['E1', 'E2']));
});

test('fetchSchedule retries a window at a smaller page size on a complexity error', async () => {
  const q = makeQuery({
    events: [{ id: 'E1', name: 'Main' }],
    setsByEvent: { E1: makeSets(2, 1, 60) },
    complexityAbove: 25,
  });

  const matches = await fetchSchedule(tournament, { query: q });

  assert.equal(statusCounts(matches).running, capFor(2), 'live matches still collected after the retry');
  const liveCalls = q.eventCalls().filter((c) => c.vars.state.includes(2));
  const perPages = liveCalls.map((c) => c.vars.perPage);
  assert.ok(perPages.includes(50), 'attempted the large page size first');
  assert.ok(perPages.includes(25), 'retried at the smaller page size');
});

test('fetchSchedule accepts a slug that is already a full tournament path', async () => {
  const q = makeQuery({ events: [{ id: 'E1', name: 'Main' }], setsByEvent: { E1: makeSets(2, 1, 1) } });
  await fetchSchedule({ external_id: 'tournament/already-pathed', name: 'x' }, { query: q });
  const head = q.tournamentHeadCalls()[0];
  assert.equal(head.vars.slug, 'tournament/already-pathed', 'an existing path is not double-prefixed');
});

test('fetchSchedule scopes a full start.gg event path to that single event', async () => {
  const q = makeQuery({
    name: 'Evo 2026',
    eventName: 'TEKKEN 8',
    events: [{ id: 'TEKKEN', name: 'TEKKEN 8' }],
    setsByEvent: { TEKKEN: makeSets(2, 1, 2) },
    videogame: 'TEKKEN 8',
  });

  const matches = await fetchSchedule({ external_id: 'tournament/evo-2026/event/tekken-8', name: 'x' }, { query: q });

  assert.equal(matches.length, 2);
  assert.equal(q.eventHeadCalls()[0].vars.slug, 'tournament/evo-2026/event/tekken-8');
  assert.equal(q.tournamentHeadCalls().length, 0, 'event URLs do not walk all tournament events');
  assert.deepEqual(new Set(q.eventCalls().map((c) => c.vars.eventId)), new Set(['TEKKEN']));
});

test('resolveTournamentGame maps the videogame name to a bot slug, null when unknown', async () => {
  const rl = makeQuery({ events: [{ id: 'E1', name: '1v1 Open' }], videogame: 'Rocket League' });
  assert.equal(await resolveTournamentGame(tournament, { query: rl }), 'rocketleague');

  const tekken = makeQuery({ events: [{ id: 'E1', name: 'TEKKEN 8' }], videogame: 'TEKKEN 8' });
  assert.equal(
    await resolveTournamentGame({ external_id: 'tournament/evo-2026/event/tekken-8' }, { query: tekken }),
    'fighters',
  );

  const unknown = makeQuery({ events: [{ id: 'E1', name: 'x' }], videogame: 'Some Untracked Game' });
  assert.equal(await resolveTournamentGame(tournament, { query: unknown }), null);

  const none = makeQuery({ events: [{ id: 'E1', name: 'x' }], videogame: null });
  assert.equal(await resolveTournamentGame(tournament, { query: none }), null);
});

test('fetchMatch resolves one set directly by id (sgg: prefix stripped)', async () => {
  const q = async (gql, vars) => {
    assert.match(gql, /set\(id/);
    assert.equal(vars.id, '104353062', 'the sgg: prefix is stripped before querying');
    return {
      set: {
        id: 104353062,
        state: 3,
        startAt: 1781967600,
        winnerId: 1,
        slots: [
          { entrant: { id: 1, name: 'Mawkzy' }, standing: { stats: { score: { value: 4 } } } },
          { entrant: { id: 2, name: 'rebmob' }, standing: { stats: { score: { value: 1 } } } },
        ],
      },
    };
  };
  const m = await fetchMatch('sgg:104353062', { query: q });
  assert.equal(m.externalId, 'sgg:104353062');
  assert.equal(m.status, 'finished');
  assert.equal(m.winner, 'Mawkzy');
  assert.equal(m.scoreA, 4);
  assert.equal(m.scoreB, 1);
});

test('fetchMatch returns null when the set is missing', async () => {
  assert.equal(await fetchMatch('sgg:999', { query: async () => ({ set: null }) }), null);
});

test('resolveTournamentTitle returns the real name, null on error or blank', async () => {
  const ok = makeQuery({ name: 'RLCS 2026 NA 1v1 Open', events: [] });
  assert.equal(await resolveTournamentTitle(tournament, { query: ok }), 'RLCS 2026 NA 1v1 Open');

  const event = makeQuery({ name: 'Evo 2026', eventName: 'TEKKEN 8', events: [{ id: 'E1', name: 'TEKKEN 8' }] });
  assert.equal(
    await resolveTournamentTitle({ external_id: 'tournament/evo-2026/event/tekken-8' }, { query: event }),
    'Evo 2026: TEKKEN 8',
  );

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
  const finished = normalizeSet(buildSet(7, { state: 3 }));
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
