import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= 'test-client';
process.env.DISCORD_GUILD_ID ||= 'test-guild';

const {
  createLpdbClient,
  LpdbError,
  normalize,
  scheduleConditions,
} = await import('../src/services/lpdb.js');
const { fetchSchedule: fetchLiquipediaSchedule } = await import('../src/services/liquipedia/fetchers.js');

const TOURNAMENT = { external_id: 'valorant/Champions_Tour/2026' };

function match(id) {
  return {
    match2id: String(id),
    match2opponents: [{ name: 'Alpha' }, { name: 'Beta' }],
    date: '2099-01-01 12:00:00',
  };
}

function matches(start, count) {
  return Array.from({ length: count }, (_, index) => match(start + index));
}

function result(rows) {
  return { data: { result: rows } };
}

function fakeClock(at = 1_000_000) {
  const sleeps = [];
  return {
    now: () => at,
    sleep: async (ms) => {
      sleeps.push(ms);
      at += ms;
    },
    advance: (ms) => { at += ms; },
    sleeps,
  };
}

function memoryRateState(initial = {}) {
  let state = { lastRequestAt: 0, blockedUntil: 0, ...initial };
  return {
    load: () => ({ ...state }),
    save: (next) => { state = { ...next }; },
    value: () => ({ ...state }),
  };
}

function errorWithStatus(status, headers = {}) {
  const error = new Error('fake LPDB failure');
  error.response = { status, headers, data: 'never log this response body' };
  return error;
}

test('LPDB tournament schedules query the official parent field', () => {
  assert.equal(
    scheduleConditions('FC_Pro_26/World_Championship'),
    '[[parent::FC_Pro_26/World_Championship]] OR [[pagename::FC_Pro_26/World_Championship]]',
  );
});

test('LPDB tournament schedule conditions normalize spaces and reject condition syntax', () => {
  assert.equal(scheduleConditions('FC Pro 26/World Championship'),
    '[[parent::FC_Pro_26/World_Championship]] OR [[pagename::FC_Pro_26/World_Championship]]');
  assert.equal(scheduleConditions('Event]] OR [[finished::0'), null);
  assert.equal(scheduleConditions(''), null);
});

test('LPDB normalization preserves match identity and finished results', () => {
  const normalized = normalize({
    match2id: '123',
    match2opponents: [{ name: 'Alpha_Team', score: '2' }, { template: 'Beta Team', score: '1' }],
    bestof: '3',
    date: '2099-01-01 12:00:00',
    finished: 1,
    winner: 1,
  }, 'valorant');

  assert.equal(normalized.externalId, '123');
  assert.equal(normalized.name, 'Alpha Team vs Beta Team');
  assert.equal(normalized.status, 'finished');
  assert.equal(normalized.winner, 'Alpha Team');
  assert.equal(normalized.bestOf, 3);
});

test('LPDB rate state tolerates missing or corrupt files and safely replaces state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lpdb-rate-state-'));
  const statePath = join(directory, 'state.json');
  const previousPath = process.env.LPDB_RATE_STATE_PATH;
  try {
    process.env.LPDB_RATE_STATE_PATH = statePath;
    const moduleUrl = `${pathToFileURL(join(process.cwd(), 'src/services/lpdbRateState.js')).href}?test=${Date.now()}`;
    const { loadLpdbRateState, saveLpdbRateState } = await import(moduleUrl);

    assert.deepEqual(loadLpdbRateState(), { lastRequestAt: 0, blockedUntil: 0 });
    writeFileSync(statePath, 'not json');
    assert.deepEqual(loadLpdbRateState(), { lastRequestAt: 0, blockedUntil: 0 });
    writeFileSync(statePath, JSON.stringify({ lastRequestAt: 'Infinity', blockedUntil: -1 }));
    assert.deepEqual(loadLpdbRateState(), { lastRequestAt: 0, blockedUntil: 0 });

    saveLpdbRateState({ lastRequestAt: 65_000, blockedUntil: 125_000 });
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')), { lastRequestAt: 65_000, blockedUntil: 125_000 });
  } finally {
    if (previousPath === undefined) delete process.env.LPDB_RATE_STATE_PATH;
    else process.env.LPDB_RATE_STATE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('LPDB accepts empty and short first pages without a continuation request', async () => {
  for (const rows of [[], matches(0, 199)]) {
    const calls = [];
    const clock = fakeClock();
    const state = memoryRateState();
    const service = createLpdbClient({
      http: {
        get: async (_path, options) => {
          calls.push(options.params);
          return result(rows);
        },
      },
      now: clock.now,
      sleep: clock.sleep,
      loadRateState: state.load,
      saveRateState: state.save,
    });

    const schedule = await service.fetchSchedule(TOURNAMENT);
    assert.equal(schedule.length, rows.length);
    assert.deepEqual(calls.map((call) => call.offset), [0]);
    assert.deepEqual(calls[0], {
      wiki: 'valorant',
      conditions: '[[parent::Champions_Tour/2026]] OR [[pagename::Champions_Tour/2026]]',
      limit: 200,
      offset: 0,
      order: 'date ASC',
    });
  }
});

test('LPDB advances offset after a full page and stops at the next short page', async () => {
  const clock = fakeClock();
  const state = memoryRateState();
  const calls = [];
  const pages = new Map([[0, matches(0, 200)], [200, matches(200, 3)]]);
  const service = createLpdbClient({
    http: {
      get: async (_path, options) => {
        calls.push({ at: clock.now(), ...options.params });
        return result(pages.get(options.params.offset));
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  });

  const schedule = await service.fetchSchedule(TOURNAMENT);
  assert.equal(schedule.length, 203);
  assert.deepEqual(calls.map((call) => call.offset), [0, 200]);
  assert.equal(calls[1].at - calls[0].at, 65_000);
});

test('LPDB traverses multiple full pages and dedupes only after traversal completes', async () => {
  const clock = fakeClock();
  const state = memoryRateState();
  const calls = [];
  const pages = new Map([
    [0, matches(0, 200)],
    [200, matches(200, 200)],
    [400, [...matches(399, 1), ...matches(400, 5)]],
  ]);
  const service = createLpdbClient({
    http: {
      get: async (_path, options) => {
        calls.push(options.params.offset);
        return result(pages.get(options.params.offset));
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  });

  const schedule = await service.fetchSchedule(TOURNAMENT);
  assert.deepEqual(calls, [0, 200, 400]);
  assert.equal(schedule.length, 405);
  assert.equal(new Set(schedule.map((entry) => entry.externalId)).size, schedule.length);
});

test('LPDB rejects malformed pages and never returns a partial pagination result', async () => {
  const malformed = createLpdbClient({
    http: { get: async () => ({ data: { result: {} } }) },
    now: fakeClock().now,
    sleep: fakeClock().sleep,
    loadRateState: memoryRateState().load,
    saveRateState: memoryRateState().save,
  });
  await assert.rejects(malformed.fetchSchedule(TOURNAMENT), (error) =>
    error instanceof LpdbError && error.code === 'malformed_response');

  const clock = fakeClock();
  const state = memoryRateState();
  let requestCount = 0;
  const interrupted = createLpdbClient({
    http: {
      get: async () => {
        requestCount++;
        if (requestCount === 1) return result(matches(0, 200));
        throw errorWithStatus(500);
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  });
  await assert.rejects(interrupted.fetchSchedule(TOURNAMENT), (error) =>
    error instanceof LpdbError && error.code === 'request_failed');
  assert.equal(requestCount, 2);
});

test('LPDB refuses a known-truncated traversal at the maximum page count', async () => {
  const clock = fakeClock();
  const state = memoryRateState();
  let requestCount = 0;
  const service = createLpdbClient({
    http: {
      get: async () => {
        requestCount++;
        return result(matches(requestCount * 200, 200));
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  });

  await assert.rejects(service.fetchSchedule(TOURNAMENT), (error) =>
    error instanceof LpdbError && error.code === 'truncated');
  assert.equal(requestCount, 25);
});

test('LPDB serializes distinct cache misses, single-flights duplicates, and persists spacing', async () => {
  const clock = fakeClock();
  const state = memoryRateState();
  const calls = [];
  const http = {
    get: async (_path, options) => {
      calls.push({ at: clock.now(), conditions: options.params.conditions });
      return result([]);
    },
  };
  const dependencies = {
    http,
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  };
  const service = createLpdbClient(dependencies);
  const duplicate = { external_id: 'valorant/Another_Event' };

  await Promise.all([
    service.fetchSchedule(TOURNAMENT),
    service.fetchSchedule(TOURNAMENT),
    service.fetchSchedule(duplicate),
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].at - calls[0].at, 65_000);

  const restarted = createLpdbClient(dependencies);
  await restarted.fetchSchedule({ external_id: 'valorant/Restarted_Event' });
  assert.equal(calls[2].at - calls[1].at, 65_000);
});

test('LPDB keeps its queue usable after a request rejection', async () => {
  const clock = fakeClock();
  const state = memoryRateState();
  const calls = [];
  let first = true;
  const service = createLpdbClient({
    http: {
      get: async (_path, options) => {
        calls.push({ at: clock.now(), conditions: options.params.conditions });
        if (first) {
          first = false;
          throw errorWithStatus(500);
        }
        return result([]);
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  });

  await assert.rejects(service.fetchSchedule(TOURNAMENT), (error) =>
    error instanceof LpdbError && error.code === 'request_failed');
  await service.fetchSchedule({ external_id: 'valorant/Recovered_Event' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].at - calls[0].at, 65_000);
});

test('LPDB serves complete stale data during persisted rate backoff', async () => {
  const clock = fakeClock();
  const state = memoryRateState();
  let requestCount = 0;
  const service = createLpdbClient({
    http: {
      get: async () => {
        requestCount++;
        if (requestCount === 1) return result([match('stale')]);
        throw errorWithStatus(429, { 'retry-after': '120' });
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  });

  const first = await service.fetchSchedule(TOURNAMENT);
  clock.advance(5 * 60_000 + 1);
  const stale = await service.fetchSchedule(TOURNAMENT);
  assert.deepEqual(stale, first);
  assert.ok(state.value().blockedUntil >= clock.now() + 120_000);

  await assert.rejects(service.fetchSchedule({ external_id: 'valorant/Blocked_Event' }), (error) =>
    error instanceof LpdbError && error.code === 'backoff');
  assert.equal(requestCount, 2);
});

test('LPDB persists a rate block before the next queued request can reach HTTP', async () => {
  const clock = fakeClock();
  const state = memoryRateState();
  let requestCount = 0;
  const service = createLpdbClient({
    http: {
      get: async () => {
        requestCount++;
        throw errorWithStatus(503, { 'retry-after': '120' });
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    loadRateState: state.load,
    saveRateState: state.save,
  });

  const first = service.fetchSchedule(TOURNAMENT);
  const second = service.fetchSchedule({ external_id: 'valorant/Queued_Event' });
  await assert.rejects(first, (error) => error instanceof LpdbError && error.code === 'rate_limited');
  await assert.rejects(second, (error) => error instanceof LpdbError && error.code === 'backoff');
  assert.equal(requestCount, 1);
});

test('LPDB provider blocks and truncation skip MediaWiki fallback, ordinary empty results do not', async () => {
  for (const code of ['backoff', 'rate_limited', 'truncated']) {
    let mediaWikiCalls = 0;
    await assert.rejects(fetchLiquipediaSchedule(TOURNAMENT, {
      lpdbService: {
        isEnabled: () => true,
        fetchSchedule: async () => { throw new LpdbError(code, 'test provider block'); },
      },
      loadPage: async () => {
        mediaWikiCalls++;
        return null;
      },
    }), (error) => error instanceof LpdbError && error.code === code);
    assert.equal(mediaWikiCalls, 0);
  }

  let mediaWikiCalls = 0;
  const fallback = await fetchLiquipediaSchedule(TOURNAMENT, {
    lpdbService: { isEnabled: () => true, fetchSchedule: async () => [] },
    loadPage: async () => {
      mediaWikiCalls++;
      return null;
    },
  });
  assert.deepEqual(fallback, []);
  assert.equal(mediaWikiCalls, 1);
});
