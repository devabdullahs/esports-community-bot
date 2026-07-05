import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'standings-sync-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { listStandingsForTournament, replaceTournamentStandings } = await import('../src/db/tournamentStandings.js');
const { isStandingsGame, runStandingsSync } = await import('../src/jobs/standingsSync.js');

const GUILD = 'guild-standings';
let pubgEvent;
let valEvent;

test.before(async () => {
  pubgEvent = await addTournament({
    source: 'liquipedia', external_id: 'pubg/Esports_World_Cup/2026', game: 'pubg',
    name: 'PUBG EWC', url: 'https://liquipedia.net/pubg/Esports_World_Cup/2026', guild_id: GUILD,
  });
  valEvent = await addTournament({
    source: 'liquipedia', external_id: 'valorant/Some/Cup', game: 'valorant',
    name: 'Val Cup', url: 'https://liquipedia.net/valorant/Some/Cup', guild_id: GUILD,
  });
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('standings games gate', () => {
  for (const g of ['pubg', 'pubgmobile', 'freefire', 'fortnite', 'apexlegends', 'warzone', 'tft', 'fighters']) {
    assert.ok(isStandingsGame(g), g);
  }
  assert.ok(!isStandingsGame('valorant'));
  assert.ok(!isStandingsGame(null));
});

test('sync fetches ONLY standings-format events and stores rows', async () => {
  const fetched = [];
  const summary = await runStandingsSync({
    liquipedia: {
      fetchEventStandings: async (t) => {
        fetched.push(t.external_id);
        return {
          hadRows: true,
          sections: [
            { title: 'Group Stage', entries: [
              { rank: 1, team: 'Twisted Minds', points: '87', logo: 'https://liquipedia.net/img/tm.png' },
              { rank: 2, team: 'Falcons Force', points: '81', logo: null },
            ] },
          ],
        };
      },
    },
  });
  assert.deepEqual(fetched, ['pubg/Esports_World_Cup/2026']); // valorant untouched
  assert.equal(summary.rows, 2);

  const rows = await listStandingsForTournament(pubgEvent.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].team, 'Twisted Minds');
  assert.equal(rows[0].points, '87');
  assert.equal(rows[0].section, 'Group Stage');
  assert.equal(await (async () => (await listStandingsForTournament(valEvent.id)).length)(), 0);
});

test('refresh replaces wholesale (no stale rows)', async () => {
  await replaceTournamentStandings(pubgEvent.id, [
    { title: 'Group Stage', entries: [{ rank: 1, team: 'New Leader', points: '99' }] },
  ]);
  const rows = await listStandingsForTournament(pubgEvent.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].team, 'New Leader');
});

test('an all-TBD page (rows parsed, no real teams) clears stale rows', async () => {
  // pubgEvent has rows from the previous test. An all-TBD page yields parseable
  // rows but no confirmed teams, so sections is empty AND hadRows is true — the
  // sync must clear the stale rows so hasStandings goes false.
  await replaceTournamentStandings(pubgEvent.id, [
    { title: 'Group Stage', entries: [{ rank: 1, team: 'Leftover', points: '10' }] },
  ]);
  assert.equal((await listStandingsForTournament(pubgEvent.id)).length, 1);

  const summary = await runStandingsSync({
    liquipedia: { fetchEventStandings: async () => ({ sections: [], hadRows: true }) },
  });
  assert.equal(summary.empty, 1);
  assert.equal((await listStandingsForTournament(pubgEvent.id)).length, 0); // cleared
});

test('an empty parse with NO recognized tables preserves stored rows (transient/DOM-change guard)', async () => {
  await replaceTournamentStandings(pubgEvent.id, [
    { title: 'Group Stage', entries: [{ rank: 1, team: 'Keep Me', points: '5' }] },
  ]);
  const summary = await runStandingsSync({
    liquipedia: { fetchEventStandings: async () => ({ sections: [], hadRows: false }) },
  });
  assert.equal(summary.empty, 1);
  const rows = await listStandingsForTournament(pubgEvent.id);
  assert.equal(rows.length, 1); // NOT cleared — could be a transient/partial page
  assert.equal(rows[0].team, 'Keep Me');
});

test('a fetch failure on one event never blocks the others', async () => {
  const tft = await addTournament({
    source: 'liquipedia', external_id: 'tft/Esports_World_Cup/2026', game: 'tft',
    name: 'TFT EWC', url: 'https://liquipedia.net/tft/Esports_World_Cup/2026', guild_id: GUILD,
  });
  const summary = await runStandingsSync({
    liquipedia: {
      fetchEventStandings: async (t) => {
        if (t.game === 'pubg') throw new Error('boom');
        return {
          hadRows: true,
          sections: [{ title: 'Group A', entries: [{ rank: 1, team: 'Weibo Gaming', points: '2–0', extra: '4–1' }] }],
        };
      },
    },
  });
  assert.equal(summary.failed, 1);
  assert.equal((await listStandingsForTournament(tft.id)).length, 1);
});
