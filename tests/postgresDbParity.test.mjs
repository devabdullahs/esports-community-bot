import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { validatePostgresTestConfig } from '../scripts/run-postgres-tests.mjs';

const BASE_ENV = {
  ALLOW_POSTGRES_TEST_RESET: '1',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/ecb_ci_test',
};

test('PostgreSQL test guard rejects missing reset opt-in', () => {
  assert.throws(
    () => validatePostgresTestConfig({ DATABASE_URL: BASE_ENV.DATABASE_URL }),
    /ALLOW_POSTGRES_TEST_RESET=1/,
  );
});

test('PostgreSQL test guard rejects a missing or malformed URL', () => {
  assert.throws(
    () => validatePostgresTestConfig({ ALLOW_POSTGRES_TEST_RESET: '1' }),
    /DATABASE_URL is required/,
  );
  assert.throws(
    () => validatePostgresTestConfig({ ALLOW_POSTGRES_TEST_RESET: '1', DATABASE_URL: 'not-a-url' }),
    /valid PostgreSQL URL/,
  );
});

test('PostgreSQL test guard rejects non-test databases and protocols', () => {
  assert.throws(
    () =>
      validatePostgresTestConfig({
        ALLOW_POSTGRES_TEST_RESET: '1',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/esports_community',
      }),
    /ending in _test/,
  );
  assert.throws(
    () =>
      validatePostgresTestConfig({
        ALLOW_POSTGRES_TEST_RESET: '1',
        DATABASE_URL: 'https://127.0.0.1/ecb_ci_test',
      }),
    /postgres or postgresql protocol/,
  );
});

test('PostgreSQL test guard rejects remote hosts outside CI', () => {
  assert.throws(
    () =>
      validatePostgresTestConfig({
        ALLOW_POSTGRES_TEST_RESET: '1',
        DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/ecb_ci_test',
      }),
    /loopback host/,
  );
});

test('PostgreSQL test guard requires the explicit CI host marker', () => {
  const ciEnv = {
    ALLOW_POSTGRES_TEST_RESET: '1',
    DATABASE_URL: 'postgresql://postgres:postgres@postgres:5432/ecb_ci_test',
    CI: 'true',
  };
  assert.throws(() => validatePostgresTestConfig(ciEnv), /POSTGRES_TEST_HOST_ALLOWED=1/);
  assert.equal(validatePostgresTestConfig({ ...ciEnv, POSTGRES_TEST_HOST_ALLOWED: '1' }).database, 'ecb_ci_test');
});

test('PostgreSQL test guard accepts a marked loopback test database', () => {
  const config = validatePostgresTestConfig(BASE_ENV);
  assert.deepEqual(
    { database: config.database, host: config.host },
    { database: 'ecb_ci_test', host: '127.0.0.1' },
  );
});

const postgresEnabled =
  process.env.DB_DRIVER === 'postgres' &&
  process.env.ALLOW_POSTGRES_TEST_RESET === '1' &&
  Boolean(process.env.DATABASE_URL);

test('PostgreSQL DB parity', { skip: postgresEnabled ? false : 'run through npm run test:postgres' }, async (t) => {
  const db = await import('../src/db/client.js');
  const predictions = await import('../src/db/ewcPredictions.js');

  t.after(async () => {
    await db.closeDbClient();
  });

  await t.test('schema is idempotent', async () => {
    const schema = await readFile(resolve('scripts/postgres/schema.sql'), 'utf8');
    await db.exec(schema);
    await db.exec(schema);
    const row = await db.get(
      `SELECT COUNT(*)::BIGINT AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'`,
    );
    assert.ok(row.count > 0);
  });

  await t.test('transaction rollback leaves no inserted row', async () => {
    await db.exec(
      'CREATE TABLE IF NOT EXISTS postgres_ci_probe (id TEXT PRIMARY KEY, value_text TEXT NOT NULL)',
    );
    await assert.rejects(
      db.transaction(async (client) => {
        await client.run('INSERT INTO postgres_ci_probe (id, value_text) VALUES ($1, $2)', [
          'rollback-row',
          'must disappear',
        ]);
        throw new Error('intentional rollback');
      }),
      /intentional rollback/,
    );
    assert.equal(
      (await db.get('SELECT COUNT(*)::BIGINT AS count FROM postgres_ci_probe WHERE id = $1', ['rollback-row']))
        .count,
      0,
    );
  });

  await t.test('transaction commit persists all writes', async () => {
    await db.transaction(async (client) => {
      await client.run('INSERT INTO postgres_ci_probe (id, value_text) VALUES ($1, $2)', [
        'commit-one',
        'first',
      ]);
      await client.run('INSERT INTO postgres_ci_probe (id, value_text) VALUES ($1, $2)', [
        'commit-two',
        'second',
      ]);
    });
    assert.equal(
      (
        await db.get(
          `SELECT COUNT(*)::BIGINT AS count
           FROM postgres_ci_probe
           WHERE id IN ($1, $2)`,
          ['commit-one', 'commit-two'],
        )
      ).count,
      2,
    );
  });

  const guildId = 'postgres-ci-guild';
  const season = 'ci-2026';
  const weeklyUser = 'postgres-ci-weekly-user';
  let week;

  await t.test('normal prediction helpers round-trip weeks, picks, seasons, and scores', async () => {
    week = await predictions.upsertEwcWeek({
      guildId,
      season,
      weekKey: 'ci-week',
      label: 'PostgreSQL CI week',
      startAt: 100,
      endAt: 200,
      openAt: 50,
      closeAt: 90,
      scoreAfter: 210,
      games: [{ gameKey: 'valorant', label: 'Valorant' }],
      createdBy: 'postgres-ci',
    });
    assert.equal(week.week_key, 'ci-week');
    assert.deepEqual(week.games, [{ gameKey: 'valorant', label: 'Valorant' }]);

    await predictions.upsertWeeklyPrediction({
      guildId,
      weekId: week.id,
      userId: weeklyUser,
      picks: [{ gameKey: 'valorant', pick: 'Team Falcons' }],
    });
    await predictions.saveWeeklyPredictionScore(guildId, week.id, weeklyUser, 700, {
      scoredGames: 1,
    });
    const weekly = await predictions.getWeeklyPrediction(guildId, week.id, weeklyUser);
    assert.equal(weekly.score, 700);
    assert.equal(weekly.picks[0].pick, 'Team Falcons');
    assert.deepEqual(weekly.details, { scoredGames: 1 });

    const savedSeason = await predictions.upsertEwcSeason({
      guildId,
      season,
      label: 'PostgreSQL CI season',
      openAt: 10,
      closeAt: 20,
      scoreAfter: 30,
      topSize: 3,
      bestWeeks: 2,
      createdBy: 'postgres-ci',
    });
    assert.equal(savedSeason.season, season);

    await predictions.upsertSeasonPrediction({
      guildId,
      season,
      userId: weeklyUser,
      picks: ['Team Falcons', 'Team Liquid', 'T1'],
    });
    await predictions.saveSeasonPredictionScore(guildId, season, weeklyUser, 900, {
      exact: 1,
    });
    const seasonPrediction = await predictions.getSeasonPrediction(guildId, season, weeklyUser);
    assert.equal(seasonPrediction.score, 900);
    assert.deepEqual(seasonPrediction.picks, ['Team Falcons', 'Team Liquid', 'T1']);
    assert.deepEqual(seasonPrediction.details, { exact: 1 });
  });

  await t.test('concurrent FOR UPDATE writes preserve both game picks', async () => {
    const userId = 'postgres-ci-concurrent-user';
    await predictions.upsertWeeklyPrediction({
      guildId,
      weekId: week.id,
      userId,
      picks: [],
    });

    let arrivals = 0;
    let release;
    const ready = new Promise((resolveReady) => {
      release = resolveReady;
    });
    const meet = async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await ready;
    };

    const writePick = (gameKey, pick) =>
      db.transaction(async (client) => {
        await meet();
        return predictions.upsertWeeklyGamePick({
          guildId,
          weekId: week.id,
          userId,
          gameKey,
          game: gameKey,
          pick,
          pickedAt: 123,
          client,
        });
      });

    await Promise.all([
      writePick('dota2', 'Team Falcons'),
      writePick('valorant', 'Team Liquid'),
    ]);

    const saved = await predictions.getWeeklyPrediction(guildId, week.id, userId);
    assert.deepEqual(
      saved.picks.map((entry) => [entry.gameKey, entry.pick]),
      [
        ['dota2', 'Team Falcons'],
        ['valorant', 'Team Liquid'],
      ],
    );
  });
});
