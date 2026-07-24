import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { startProduction } from '../src/start-production.js';

function createLogger() {
  return {
    errors: [],
    logs: [],
    error(message) {
      this.errors.push(message);
    },
    log(message) {
      this.logs.push(message);
    },
  };
}

function createSpawn(calls, onSpawn) {
  return (command, args, options) => {
    onSpawn?.();
    const child = new EventEmitter();
    child.pid = calls.length + 1;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    calls.push({ command, args, options, child });
    return child;
  };
}

test('production startup migration failure starts no services', async () => {
  const calls = [];
  const logger = createLogger();
  const secretUrl = 'postgresql://user:secret-password@example.test/ecb';

  const exitCode = await startProduction({
    env: { RUN_BOT: 'true', RUN_WEB: 'true', DATABASE_URL: secretUrl },
    migrate: async () => {
      throw new Error('could not connect to ' + secretUrl);
    },
    spawnImpl: createSpawn(calls),
    logger,
    waitForExit: false,
  });

  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0);
  assert.match(logger.errors[0], /PostgreSQL migrations failed/);
  assert.doesNotMatch(logger.errors[0], /secret-password|example\.test/);
});

test('production startup gates every requested service on successful migrations', async () => {
  const cases = [
    { env: { RUN_BOT: 'true', RUN_WEB: 'false' }, expected: ['src/index.js'] },
    { env: { RUN_BOT: 'false', RUN_WEB: 'true' }, expected: ['start'] },
    { env: { RUN_BOT: 'true', RUN_WEB: 'true' }, expected: ['src/index.js', 'start'] },
  ];

  for (const { env, expected } of cases) {
    const calls = [];
    const logger = createLogger();
    let migrationCalls = 0;
    const result = await startProduction({
      env,
      migrate: async () => {
        migrationCalls += 1;
      },
      spawnImpl: createSpawn(calls, () => assert.equal(migrationCalls, 1)),
      logger,
      waitForExit: false,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(migrationCalls, 1);
    assert.deepEqual(calls.map(({ args }) => args[0]), expected);
  }
});

test('production image includes the migration CLI required by web-only prestart', () => {
  const webPackage = JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url), 'utf8'));
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

  assert.equal(webPackage.scripts.prestart, 'node ../../scripts/run-postgres-migrations.mjs');
  assert.match(
    dockerfile,
    /COPY --from=build --chown=node:node \/app\/scripts\/run-postgres-migrations\.mjs \.\/scripts\/run-postgres-migrations\.mjs/,
  );
});
