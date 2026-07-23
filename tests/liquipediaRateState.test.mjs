import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';

const { createRateStateStore } = await import('../src/services/liquipedia/rateState.js');

function createMemoryFileSystem(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const calls = [];
  return {
    calls,
    files,
    mkdirSync(path, options) {
      calls.push({ method: 'mkdirSync', path, options });
    },
    readFileSync(path) {
      calls.push({ method: 'readFileSync', path });
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    },
    writeFileSync(path, contents) {
      calls.push({ method: 'writeFileSync', path, contents });
      files.set(path, contents);
    },
    renameSync(from, to) {
      calls.push({ method: 'renameSync', from, to });
      if (!files.has(from)) throw new Error('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

function createStore(fileSystem) {
  return createRateStateStore({
    rateStatePath: '/state/liquipedia.json',
    fileSystem,
    now: () => 10_000,
    log: { debug() {} },
  });
}

test('rate state migrates the old two-field format conservatively', () => {
  const fileSystem = createMemoryFileSystem({
    '/state/liquipedia.json': JSON.stringify({ lastRequestAt: 12_345, blockedUntil: 67_890 }),
  });
  const store = createStore(fileSystem);

  store.loadRateState();

  assert.deepEqual(store.rateState, {
    lastRequestAt: 12_345,
    lastParseAt: 12_345,
    blockedUntil: 67_890,
    loaded: true,
  });
});

test('rate state ignores a new-format record when any timestamp is invalid', () => {
  const fileSystem = createMemoryFileSystem({
    '/state/liquipedia.json': JSON.stringify({
      lastRequestAt: 12_345,
      lastParseAt: 9_876,
      blockedUntil: -1,
    }),
  });
  const store = createStore(fileSystem);

  store.loadRateState();

  assert.deepEqual(store.rateState, {
    lastRequestAt: 0,
    lastParseAt: 0,
    blockedUntil: 0,
    loaded: true,
  });
});

test('rate state treats missing and corrupt files as a first run', () => {
  const missing = createStore(createMemoryFileSystem());
  missing.loadRateState();
  assert.deepEqual(missing.rateState, {
    lastRequestAt: 0,
    lastParseAt: 0,
    blockedUntil: 0,
    loaded: true,
  });

  const corrupt = createStore(createMemoryFileSystem({ '/state/liquipedia.json': '{not json' }));
  corrupt.loadRateState();
  assert.deepEqual(corrupt.rateState, {
    lastRequestAt: 0,
    lastParseAt: 0,
    blockedUntil: 0,
    loaded: true,
  });

  const fileSystem = createMemoryFileSystem({
    '/state/liquipedia.json': JSON.stringify({ lastRequestAt: 1_000, lastParseAt: 900, blockedUntil: 2_000 }),
  });
  const preserved = createStore(fileSystem);
  preserved.loadRateState();
  fileSystem.files.set('/state/liquipedia.json', '{not json');
  preserved.loadRateState({ force: true });
  assert.deepEqual(preserved.rateState, {
    lastRequestAt: 1_000,
    lastParseAt: 900,
    blockedUntil: 2_000,
    loaded: true,
  });
});

test('rate state writes a complete replacement through a sibling temporary file', () => {
  const fileSystem = createMemoryFileSystem();
  const store = createStore(fileSystem);
  store.rateState.lastRequestAt = 1_000;
  store.rateState.lastParseAt = 900;
  store.rateState.blockedUntil = 2_000;

  store.saveRateState();

  assert.deepEqual(
    fileSystem.calls.map((call) => call.method),
    ['mkdirSync', 'writeFileSync', 'renameSync'],
  );
  assert.equal(fileSystem.calls[1].path, '/state/liquipedia.json.tmp');
  assert.deepEqual(fileSystem.calls[2], {
    method: 'renameSync',
    from: '/state/liquipedia.json.tmp',
    to: '/state/liquipedia.json',
  });
  assert.equal(fileSystem.files.has('/state/liquipedia.json.tmp'), false);
  assert.deepEqual(JSON.parse(fileSystem.files.get('/state/liquipedia.json')), {
    lastRequestAt: 1_000,
    lastParseAt: 900,
    blockedUntil: 2_000,
  });
});
