import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { alignMatchDetailsSides, parseMatchDetails } = await import('../src/services/liquipedia/matchDetailsParsers.js');
const { fetchMatchDetails } = await import('../src/services/liquipedia/fetchers.js');

const valorantHtml = readFileSync('tests/fixtures/liquipedia-valorant-match-details.html', 'utf8');
const dotaHtml = readFileSync('tests/fixtures/liquipedia-dota2-match-details.html', 'utf8');

test('Valorant match details parse vetoes, maps, and player columns from the fixture', () => {
  const details = parseMatchDetails('valorant', valorantHtml);
  assert.equal(details.kind, 'valorant');
  assert.equal(details.patch, '13.00');
  assert.deepEqual(details.casters, ['Paperthin', 'Achilios']);
  assert.equal(details.veto.length, 7);
  assert.deepEqual(details.veto[0], { order: 1, action: 'ban', map: 'Sunset', team: 'b' });
  assert.deepEqual(details.maps.map((map) => [map.scoreA, map.scoreB]), [[13, 2], [10, 13], [13, 5]]);
  for (const map of details.maps) {
    assert.equal(map.players.a.length, 5);
    assert.equal(map.players.b.length, 5);
  }
  assert.deepEqual(details.maps[0].players.a[0], {
    name: 'Timotino',
    agents: ['Neon'],
    acs: 279,
    kills: 16,
    deaths: 7,
    assists: 2,
    kastPct: '80.0%',
    adr: 165,
    hsPct: '29.7%',
    fk: 4,
    fd: 2,
  });
});

test('Dota 2 match details parse drafts, team stats, and player performance', () => {
  const details = parseMatchDetails('dota2', dotaHtml);
  assert.equal(details.kind, 'dota2');
  assert.equal(details.games.length, 2);
  assert.ok(details.games.flatMap((game) => [...game.draft.a.picks, ...game.draft.b.picks]).every((pick) => Number.isInteger(pick.order)));
  assert.equal(details.games[0].duration, '31:18');
  assert.equal(details.games[0].teamStats.a.gold, '65.2K');
  assert.equal(details.games[0].teamStats.a.towers, 0);
  assert.equal(details.games[0].teamStats.b.towers, 4);
  assert.equal(details.games[0].teamStats.a.roshans, 0);
  assert.equal(details.games[0].teamStats.b.roshans, 2);
  assert.equal(details.games[0].players.a.length, 5);
  assert.equal(details.games[0].players.b.length, 5);
  assert.deepEqual(details.games[0].players.a[0], {
    name: 'TA2000',
    hero: 'Drow Ranger',
    kills: 0,
    deaths: 9,
    assists: 1,
    dmg: '4.7K',
    lhdn: '239/8',
    net: '13.5K',
    gpm: 430,
  });
});

test('unsupported, garbage, and degraded details HTML remain safe', () => {
  assert.equal(parseMatchDetails('leagueoflegends', valorantHtml), null);
  assert.equal(parseMatchDetails('valorant', '<main>nothing here</main>'), null);
  const withoutVeto = valorantHtml.replace(/<div class="match-bm-map-veto-cards"[\s\S]*?<\/div><div class="toggle-area/, '<div class="toggle-area');
  const details = parseMatchDetails('valorant', withoutVeto);
  assert.ok(details);
  assert.deepEqual(details.veto, []);
  assert.equal(details.maps.length, 3);
});

test('match details align page teams to the stored match order before storage', () => {
  const details = parseMatchDetails('valorant', valorantHtml);
  const aligned = alignMatchDetailsSides(details, { teamA: 'MIBR.LOS', teamB: '100 Thieves' });
  assert.equal(aligned.maps[0].scoreA, 2);
  assert.equal(aligned.maps[0].scoreB, 13);
  assert.equal(aligned.maps[0].winner, 'b');
  assert.equal(aligned.maps[0].players.a[0].name, 'Verno');
  assert.equal(aligned.veto[0].team, 'a');
});

test('match details forwards its cache-age policy through the shared parse client', async () => {
  let call = null;
  const details = await fetchMatchDetails('valorant', 'Match:Fixture', {
    teamA: '100 Thieves',
    teamB: 'MIBR.LOS',
    maxAgeMs: 0,
    parse: async (...args) => {
      call = args;
      return { parse: { text: { '*': valorantHtml } } };
    },
  });

  assert.deepEqual(call, ['valorant', 'Match:Fixture', { maxAgeMs: 0 }]);
  assert.equal(details.maps[0].scoreA, 13);
  assert.equal(details.maps[0].scoreB, 2);
});
