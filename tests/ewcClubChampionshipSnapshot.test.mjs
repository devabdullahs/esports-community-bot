import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-club-snapshot-'));
const dbPath = join(dir, 'bot.sqlite');
process.env.DB_PATH = dbPath;
process.env.LOG_LEVEL = 'error';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { db, closeDb } = await import('../src/db/index.js');
const {
  getEwcClubChampionshipSnapshot,
  getLatestEwcClubChampionshipSnapshot,
  upsertEwcClubChampionshipSnapshot,
} = await import('../src/db/ewcClubChampionshipSnapshots.js');

function snapshot(season, team, points, fetchedAt = `${season}-07-10T12:00:00.000Z`) {
  return {
    season,
    sourceUrl: `https://liquipedia.net/esports/Esports_World_Cup/${season}/Club_Championship_Standings`,
    standings: [{ rank: 1, team, points, eligibility: 'champion' }],
    prizepool: [{ place: '1st', prize: '$1,000,000', teams: [team] }],
    fetchedAt,
  };
}

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('schema is mirrored in SQLite and Postgres', () => {
  const expected = ['season', 'source_url', 'standings_json', 'prizepool_json', 'fetched_at', 'updated_at'];
  const sqliteColumns = db.prepare('PRAGMA table_info(ewc_club_championship_snapshots)').all().map((row) => row.name);
  assert.deepEqual(sqliteColumns, expected);

  const postgresSchema = readFileSync(join(root, 'scripts/postgres/schema.sql'), 'utf8');
  const create = postgresSchema.match(
    /CREATE TABLE IF NOT EXISTS ewc_club_championship_snapshots\s*\(([\s\S]*?)\);/i,
  );
  assert.ok(create, 'Postgres snapshot table exists');
  for (const column of expected) assert.match(create[1], new RegExp(`\\b${column}\\b`, 'i'));
  assert.match(postgresSchema, /idx_ewc_club_championship_snapshots_fetched/i);
});

test('inserts, atomically replaces, and keeps seasons independent', async () => {
  await upsertEwcClubChampionshipSnapshot(snapshot('2025', 'Old Guard', 70));
  await upsertEwcClubChampionshipSnapshot(snapshot('2026', 'First Leader', 100));
  await upsertEwcClubChampionshipSnapshot(
    snapshot('2026', 'New Leader', 125, '2026-07-10T13:00:00.000Z'),
  );

  const current = await getEwcClubChampionshipSnapshot('2026');
  const previous = await getEwcClubChampionshipSnapshot('2025');
  assert.equal(current.standings[0].team, 'New Leader');
  assert.equal(current.standings[0].points, 125);
  assert.equal(current.fetchedAt, '2026-07-10T13:00:00.000Z');
  assert.equal(previous.standings[0].team, 'Old Guard');
  assert.equal((await getLatestEwcClubChampionshipSnapshot()).season, '2026');
});

test('an empty or unserializable payload cannot replace the last good snapshot', async () => {
  await upsertEwcClubChampionshipSnapshot(snapshot('2027', 'Keep This Club', 90));
  await assert.rejects(
    upsertEwcClubChampionshipSnapshot({ ...snapshot('2027', 'Erase Me', 0), standings: [] }),
    /at least one row/i,
  );

  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(
    upsertEwcClubChampionshipSnapshot({ ...snapshot('2027', 'Erase Me', 0), prizepool: [cyclic] }),
    /JSON serializable/i,
  );
  assert.equal((await getEwcClubChampionshipSnapshot('2027')).standings[0].team, 'Keep This Club');
});

test('malformed stored JSON is rejected on read', async () => {
  db.prepare(
    `INSERT INTO ewc_club_championship_snapshots
       (season, source_url, standings_json, prizepool_json, fetched_at, updated_at)
     VALUES (?, ?, ?, '[]', ?, ?)
     ON CONFLICT(season) DO UPDATE SET standings_json = excluded.standings_json`,
  ).run(
    '2099',
    'https://liquipedia.net/esports/Esports_World_Cup/2099/Club_Championship_Standings',
    '{not-json',
    '2099-01-01T00:00:00.000Z',
    '2099-01-01T00:00:00.000Z',
  );
  assert.equal(await getEwcClubChampionshipSnapshot('2099'), null);
});

test('a committed snapshot reads back in a fresh process', async () => {
  await upsertEwcClubChampionshipSnapshot(snapshot('2028', 'Restart Club', 88));
  const moduleUrl = pathToFileURL(join(root, 'src/db/ewcClubChampionshipSnapshots.js')).href;
  const script = `
    const { getEwcClubChampionshipSnapshot } = await import(${JSON.stringify(moduleUrl)});
    const value = await getEwcClubChampionshipSnapshot('2028');
    process.stdout.write(JSON.stringify(value));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, DB_PATH: dbPath },
  });
  assert.equal(JSON.parse(output).standings[0].team, 'Restart Club');
});
