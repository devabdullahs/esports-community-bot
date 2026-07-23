import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { createLiquipediaRequestScheduler } = await import('../src/services/liquipedia/scheduler.js');
const { createLiquipediaClient } = await import('../src/services/liquipedia/client.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createClock(start = 100_000) {
  let current = start;
  const sleeps = [];
  return {
    now: () => current,
    sleep: async (ms) => {
      sleeps.push(ms);
      current += ms;
    },
    advance: (ms) => { current += ms; },
    sleeps,
  };
}

function createState(initial = {}) {
  const rateState = {
    lastRequestAt: 0,
    lastParseAt: 0,
    blockedUntil: 0,
    ...initial,
  };
  let saves = 0;
  return {
    rateState,
    loadRateState() {},
    saveRateState() { saves++; },
    get saves() { return saves; },
  };
}

function createPersistedState(persisted) {
  const rateState = { lastRequestAt: 0, lastParseAt: 0, blockedUntil: 0 };
  return {
    rateState,
    loadRateState() {
      Object.assign(rateState, persisted);
    },
    saveRateState() {
      Object.assign(persisted, rateState);
    },
  };
}

function createClientHarness({ clock = createClock(), state = createState(), get, ...options } = {}) {
  const calls = [];
  const client = createLiquipediaClient({
    http: {
      async get(url, request) {
        calls.push({ url, request });
        return get ? get(url, request, calls.length) : { data: {} };
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    rateState: state.rateState,
    loadRateState: state.loadRateState,
    saveRateState: state.saveRateState,
    markRateLimited(durationMs) {
      state.rateState.blockedUntil = Math.max(state.rateState.blockedUntil, clock.now() + durationMs);
      state.saveRateState();
    },
    log: { warn() {}, debug() {} },
    cacheTtlMs: 1_000,
    searchCacheTtlMs: 1_000,
    backoffMs: 5_000,
    ...options,
  });
  return { client, clock, state, calls };
}

test('scheduler admits parse and search tasks one at a time in order', async () => {
  const clock = createClock();
  const state = createState();
  const scheduler = createLiquipediaRequestScheduler({ ...state, now: clock.now, sleep: clock.sleep });
  const gate = deferred();
  const events = [];
  let active = 0;
  let maxActive = 0;

  const first = scheduler.schedule('parse', async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    events.push({ kind: 'parse', at: clock.now() });
    await gate.promise;
    active--;
  });
  const second = scheduler.schedule('search', async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    events.push({ kind: 'search', at: clock.now() });
    active--;
  });

  await flush();
  assert.deepEqual(events, [{ kind: 'parse', at: 100_000 }]);
  assert.equal(maxActive, 1);
  gate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(events, [
    { kind: 'parse', at: 100_000 },
    { kind: 'search', at: 102_500 },
  ]);
  assert.equal(maxActive, 1);
  assert.deepEqual(clock.sleeps, [2_500]);
});

test('scheduler applies parse and shared request floors with exact fake timestamps', async () => {
  const clock = createClock();
  const state = createState();
  const scheduler = createLiquipediaRequestScheduler({ ...state, now: clock.now, sleep: clock.sleep });
  const events = [];

  await Promise.all([
    scheduler.schedule('parse', () => { events.push({ kind: 'parse', at: clock.now() }); }),
    scheduler.schedule('search', () => { events.push({ kind: 'search', at: clock.now() }); }),
    scheduler.schedule('parse', () => { events.push({ kind: 'parse', at: clock.now() }); }),
  ]);

  assert.deepEqual(events, [
    { kind: 'parse', at: 100_000 },
    { kind: 'search', at: 102_500 },
    { kind: 'parse', at: 130_000 },
  ]);
  assert.deepEqual(clock.sleeps, [2_500, 27_500]);
});

test('a queued search cannot overlap a sleeping or running parse', async () => {
  const clock = createClock();
  const state = createState({ lastRequestAt: 100_000, lastParseAt: 100_000 });
  const sleepers = [];
  const sleep = (ms) => {
    const wait = deferred();
    sleepers.push({ ms, resolve: () => { clock.advance(ms); wait.resolve(); } });
    return wait.promise;
  };
  const scheduler = createLiquipediaRequestScheduler({ ...state, now: clock.now, sleep });
  const parseGate = deferred();
  const events = [];

  const parse = scheduler.schedule('parse', async () => {
    events.push({ kind: 'parse', at: clock.now() });
    await parseGate.promise;
  });
  const search = scheduler.schedule('search', () => { events.push({ kind: 'search', at: clock.now() }); });

  await flush();
  assert.deepEqual(events, []);
  assert.deepEqual(sleepers.map((entry) => entry.ms), [30_000]);
  sleepers[0].resolve();
  await flush();
  assert.deepEqual(events, [{ kind: 'parse', at: 130_000 }]);
  parseGate.resolve();
  await flush();
  assert.deepEqual(sleepers.map((entry) => entry.ms), [30_000, 2_500]);
  sleepers[1].resolve();
  await Promise.all([parse, search]);
  assert.deepEqual(events, [
    { kind: 'parse', at: 130_000 },
    { kind: 'search', at: 132_500 },
  ]);
});

test('a queued parse cannot overlap a sleeping or running search', async () => {
  const clock = createClock();
  const state = createState({ lastRequestAt: 100_000 });
  const sleepers = [];
  const sleep = (ms) => {
    const wait = deferred();
    sleepers.push({ ms, resolve: () => { clock.advance(ms); wait.resolve(); } });
    return wait.promise;
  };
  const scheduler = createLiquipediaRequestScheduler({ ...state, now: clock.now, sleep });
  const searchGate = deferred();
  const events = [];

  const search = scheduler.schedule('search', async () => {
    events.push({ kind: 'search', at: clock.now() });
    await searchGate.promise;
  });
  const parse = scheduler.schedule('parse', () => { events.push({ kind: 'parse', at: clock.now() }); });

  await flush();
  assert.deepEqual(sleepers.map((entry) => entry.ms), [2_500]);
  sleepers[0].resolve();
  await flush();
  assert.deepEqual(events, [{ kind: 'search', at: 102_500 }]);
  searchGate.resolve();
  await flush();
  assert.deepEqual(sleepers.map((entry) => entry.ms), [2_500, 2_500]);
  sleepers[1].resolve();
  await Promise.all([search, parse]);
  assert.deepEqual(events, [
    { kind: 'search', at: 102_500 },
    { kind: 'parse', at: 105_000 },
  ]);
});

test('scheduler persistence preserves shared and parse-specific gaps across restart', async () => {
  const clock = createClock();
  const persisted = { lastRequestAt: 0, lastParseAt: 0, blockedUntil: 0 };
  const firstState = createPersistedState(persisted);
  const firstScheduler = createLiquipediaRequestScheduler({ ...firstState, now: clock.now, sleep: clock.sleep });
  await firstScheduler.schedule('parse', () => {});
  assert.deepEqual(persisted, { lastRequestAt: 100_000, lastParseAt: 100_000, blockedUntil: 0 });

  clock.advance(100);
  const secondState = createPersistedState(persisted);
  const secondScheduler = createLiquipediaRequestScheduler({ ...secondState, now: clock.now, sleep: clock.sleep });
  const starts = [];
  await secondScheduler.schedule('search', () => { starts.push({ kind: 'search', at: clock.now() }); });
  await secondScheduler.schedule('parse', () => { starts.push({ kind: 'parse', at: clock.now() }); });

  assert.deepEqual(starts, [
    { kind: 'search', at: 102_500 },
    { kind: 'parse', at: 130_000 },
  ]);
});

test('scheduler rejects backoff before task execution and recovers after a task rejection', async () => {
  const clock = createClock();
  const blockedState = createState({ blockedUntil: 105_000 });
  const blocked = createLiquipediaRequestScheduler({ ...blockedState, now: clock.now, sleep: clock.sleep });
  let ran = false;
  await assert.rejects(blocked.schedule('search', () => { ran = true; }), /backing off/);
  assert.equal(ran, false);

  const state = createState();
  const scheduler = createLiquipediaRequestScheduler({ ...state, now: clock.now, sleep: clock.sleep });
  const failed = scheduler.schedule('search', () => { throw new Error('injected failure'); });
  const recovered = scheduler.schedule('search', () => 'recovered');
  await assert.rejects(failed, /injected failure/);
  assert.equal(await recovered, 'recovered');
});

test('client cache hits and duplicate requests make zero extra admissions or HTTP calls', async () => {
  const parseGate = deferred();
  const parseHarness = createClientHarness({
    get: async () => parseGate.promise,
  });
  const first = parseHarness.client.parsePage('valorant', 'Home');
  const duplicate = parseHarness.client.parsePage('valorant', 'Home');
  await flush();
  assert.equal(parseHarness.calls.length, 1);
  parseGate.resolve({ data: { parse: { text: 'ok' } } });
  assert.deepEqual(await first, await duplicate);
  const savesBeforeCacheHit = parseHarness.state.saves;
  await parseHarness.client.parsePage('valorant', 'Home');
  assert.equal(parseHarness.calls.length, 1);
  assert.equal(parseHarness.state.saves, savesBeforeCacheHit);

  const searchGate = deferred();
  const searchHarness = createClientHarness({
    get: async () => searchGate.promise,
  });
  const search = searchHarness.client.searchPages('valorant', 'alpha');
  const duplicateSearch = searchHarness.client.searchPages('valorant', 'alpha');
  await flush();
  assert.equal(searchHarness.calls.length, 1);
  searchGate.resolve({ data: ['alpha', ['Alpha'], ['Team'], ['https://liquipedia.net/valorant/Alpha']] });
  assert.deepEqual(await search, await duplicateSearch);
  await searchHarness.client.searchPages('valorant', 'alpha');
  assert.equal(searchHarness.calls.length, 1);
});

test('client marks 403, 429, and 503 responses as a shared persistent backoff', async () => {
  for (const status of [403, 429, 503]) {
    const harness = createClientHarness({
      get: async () => {
        const error = new Error('injected HTTP failure');
        error.response = { status, data: 'blocked' };
        throw error;
      },
    });

    assert.deepEqual(await harness.client.searchPages('valorant', `status-${status}`), []);
    assert.equal(harness.state.rateState.blockedUntil, 105_000);
    assert.equal(harness.calls.length, 1);
  }
});

test('client preserves strict successful empty-search detection', async () => {
  const harness = createClientHarness({
    get: async () => ({ data: ['none', [], [], []] }),
  });

  assert.deepEqual(await harness.client.searchPagesStrict('valorant', 'none'), { ok: true, results: [] });
  assert.equal(harness.calls.length, 1);
});

test('client detects rate-limit bodies for parses and keeps stale parse data', async () => {
  let request = 0;
  const harness = createClientHarness({
    get: async () => {
      request++;
      if (request === 1) return { data: { parse: { text: 'cached' } } };
      const error = new Error('injected HTTP failure');
      error.response = { status: 500, data: 'temporarily blocked' };
      throw error;
    },
  });

  const cached = await harness.client.parsePage('valorant', 'Home');
  harness.clock.advance(1_001);
  assert.deepEqual(await harness.client.parsePage('valorant', 'Home'), cached);
  assert.equal(harness.state.rateState.blockedUntil, 135_000);
  assert.deepEqual(await harness.client.searchPages('valorant', 'blocked'), []);
  assert.equal(harness.calls.length, 2);
});

test('client returns empty on non-rate search errors and frees a full search queue after success and failure', async () => {
  let request = 0;
  const firstGate = deferred();
  const harness = createClientHarness({
    searchMaxQueue: 1,
    get: async () => {
      request++;
      if (request === 1) return firstGate.promise;
      if (request === 2) throw new Error('offline');
      return { data: ['three', ['Three'], ['Team'], ['https://liquipedia.net/valorant/Three']] };
    },
  });

  const first = harness.client.searchPages('valorant', 'one');
  await flush();
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(await harness.client.searchPages('valorant', 'two'), []);
  assert.equal(harness.calls.length, 1);

  firstGate.resolve({ data: ['one', ['One'], ['Team'], ['https://liquipedia.net/valorant/One']] });
  assert.equal((await first)[0].title, 'One');
  assert.deepEqual(await harness.client.searchPages('valorant', 'two'), []);
  assert.equal(harness.state.rateState.blockedUntil, 0);
  assert.equal((await harness.client.searchPages('valorant', 'three'))[0].title, 'Three');
  assert.equal(harness.calls.length, 3);
});
