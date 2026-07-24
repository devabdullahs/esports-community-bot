import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePostgresTestConfig } from '../scripts/run-postgres-tests.mjs';
import { listPostgresMigrations } from '../src/db/postgresMigrations.js';

const BASE_ENV = {
  ALLOW_POSTGRES_TEST_RESET: '1',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/ecb_ci_test',
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
  const games = await import('../src/db/ewcGames.js');
  const media = await import('../src/db/ewcMediaChannels.js');
  const news = await import('../src/db/ewcNewsPosts.js');

  t.after(async () => {
    await db.closeDbClient();
  });

  await t.test('migrations are idempotent and ledgered', async () => {
    await db.ensurePostgresMigrations();
    await db.ensurePostgresMigrations();
    const expected = listPostgresMigrations().map(({ version, checksum }) => ({ version, checksum }));
    const ledger = await db.all('SELECT version, checksum FROM app_schema_migrations ORDER BY version ASC');
    assert.deepEqual(ledger, expected);
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

  await t.test('CMS owner deletion preserves tagged media content and blocks orphaning', async () => {
    const gameSlug = 'postgres-owner-delete';
    const mediaSlug = 'postgres-owned-channel';
    await games.createEwcGame({
      slug: gameSlug,
      title: { en: 'PostgreSQL owner delete', ar: 'PostgreSQL owner delete' },
      description: { en: '', ar: '' },
      status: { en: 'Active', ar: 'Active' },
      owner: { en: 'CI', ar: 'CI' },
      focus: [],
    });
    await media.createEwcMediaChannel({
      slug: mediaSlug,
      name: { en: 'PostgreSQL media', ar: 'PostgreSQL media' },
      description: { en: '', ar: '' },
      logoUrl: null,
      links: [],
      gameSlug,
    });
    const gamePost = await news.createEwcNewsPost({
      gameSlug,
      status: 'draft',
      contentMode: 'shared',
      defaultLocale: 'en',
      translations: { en: { title: 'Game post', summary: '', body: 'Body' } },
    });
    const mediaPost = await news.createEwcNewsPost({
      gameSlug,
      mediaSlug,
      status: 'published',
      contentMode: 'shared',
      defaultLocale: 'en',
      translations: { en: { title: 'Media post', summary: '', body: 'Body' } },
    });

    assert.deepEqual(await games.deleteEwcGame(gameSlug), {
      gameDeleted: 1,
      postsDeleted: 1,
      mediaPostsDetached: 1,
      mediaChannelsDetached: 1,
    });
    assert.equal(await news.getEwcNewsPostById(gamePost.id), null);
    assert.equal((await news.getEwcNewsPostById(mediaPost.id)).gameSlug, null);
    assert.equal((await media.getEwcMediaChannel(mediaSlug)).gameSlug, null);

    assert.deepEqual(await media.deleteEwcMediaChannel(mediaSlug), {
      deleted: 0,
      conflict: 'media_has_posts',
      postCount: 1,
    });
    assert.ok(await media.getEwcMediaChannel(mediaSlug));

    await news.deleteEwcNewsPost(mediaPost.id);
    assert.deepEqual(await media.deleteEwcMediaChannel(mediaSlug), {
      deleted: 1,
      conflict: null,
      postCount: 0,
    });
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

  await t.test('a PostgreSQL transition waits for an admitted submission before scoring its pick', async () => {
    const writes = await import('../src/lib/ewcPredictionWrites.js');
    const weekKey = 'ci-lock-race';
    const userId = 'postgres-ci-lock-user';
    const raceWeek = await predictions.upsertEwcWeek({
      guildId,
      season,
      weekKey,
      label: 'PostgreSQL lock race',
      openAt: 10,
      closeAt: 1_000,
      games: [{ key: 'valorant', game: 'Valorant', lockAt: 500 }],
      createdBy: 'postgres-ci',
    });
    const submissionLocked = deferred();
    const releaseSubmission = deferred();
    const submission = writes.submitWeeklyGamePick({
      guildId,
      season,
      userId,
      weekKey,
      gameKey: 'valorant',
      rawPick: 'Team Falcons',
      submittedAt: 100,
      resolvers: {
        participants: async () => [],
        club: async (rawPick) => ({ ok: true, name: rawPick }),
      },
      onRoundLocked: async () => {
        submissionLocked.resolve();
        await releaseSubmission.promise;
      },
    });
    await submissionLocked.promise;

    await assert.rejects(
      db.transaction(async (client) => {
        await client.exec("SET LOCAL lock_timeout = '100ms'");
        await predictions.lockEwcWeekForTransition(guildId, season, weekKey, client);
      }),
      /lock timeout/,
    );

    releaseSubmission.resolve();
    assert.equal((await submission).ok, true);

    await db.transaction(async (client) => {
      const lockedRound = await predictions.lockEwcWeekForTransition(guildId, season, weekKey, client);
      assert.equal(lockedRound.status, 'open');
      await predictions.setEwcWeekStatus(raceWeek.id, 'closed', client);
      const admitted = await predictions.listWeeklyPredictions(raceWeek.id, client, { forUpdate: true });
      assert.equal(admitted.length, 1);
      await predictions.saveWeeklyPredictionScore(guildId, raceWeek.id, admitted[0].user_id, 321, { source: 'lock-race' }, client);
      await predictions.markEwcWeekScored(raceWeek.id, [], client);
    });

    assert.equal((await predictions.getEwcWeek(guildId, season, weekKey)).status, 'scored');
    assert.equal((await predictions.getWeeklyPrediction(guildId, raceWeek.id, userId)).score, 321);
  });

  await t.test('concurrent PostgreSQL season slots reject aliases and a skipped rank', async () => {
    const writes = await import('../src/lib/ewcPredictionWrites.js');
    const raceSeason = 'ci-2026-lock-season';
    const userId = 'postgres-ci-season-lock-user';
    await predictions.upsertEwcSeason({
      guildId,
      season: raceSeason,
      label: 'PostgreSQL lock season',
      openAt: 10,
      closeAt: 1_000,
      topSize: 4,
      createdBy: 'postgres-ci',
    });
    const resolvers = {
      participants: async () => [],
      club: async (rawPick) => ({ ok: true, name: rawPick }),
    };
    assert.equal(
      (
        await writes.submitSeasonSlot({
          guildId, season: raceSeason, userId, index: 0, rawPick: 'Team Falcons', submittedAt: 100, resolvers,
        })
      ).ok,
      true,
    );
    let arrivals = 0;
    const bothResolved = deferred();
    const concurrentResolvers = {
      ...resolvers,
      club: async (rawPick) => {
        arrivals += 1;
        if (arrivals === 2) bothResolved.resolve();
        await bothResolved.promise;
        return { ok: true, name: rawPick };
      },
    };
    const attempts = await Promise.all([
      writes.submitSeasonSlot({ guildId, season: raceSeason, userId, index: 1, rawPick: 'Falcons', submittedAt: 100, resolvers: concurrentResolvers }),
      writes.submitSeasonSlot({ guildId, season: raceSeason, userId, index: 2, rawPick: 'Team Liquid', submittedAt: 100, resolvers: concurrentResolvers }),
    ]);
    assert.deepEqual(attempts.map((attempt) => attempt.code).toSorted(), ['duplicate_pick', 'slot_locked']);
    assert.deepEqual((await predictions.getSeasonPrediction(guildId, raceSeason, userId)).picks, ['Team Falcons']);
  });
});
