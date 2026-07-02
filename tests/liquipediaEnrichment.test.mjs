import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'lp-enrich-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { upsertTeam, listTeams } = await import('../src/db/teams.js');
const { listPlayers } = await import('../src/db/players.js');
const { runLiquipediaEnrichment } = await import('../src/jobs/liquipediaEnrichment.js');

const GUILD = 'guild-lp';

function mockLiquipedia({ resolveCalls = [], parseCalls = [] } = {}) {
  return {
    wikiForGame: (game) => (['rocketleague', 'tft', 'valorant'].includes(game) ? game : null),
    resolveEntityPage: async (wiki, name) => {
      resolveCalls.push({ wiki, name });
      if (name === 'Unknown Squad') return null; // unresolvable
      const page = name.replace(/ /g, '_');
      return { title: name, page, url: `https://liquipedia.net/${wiki}/${page}` };
    },
    fetchTeamEntity: async (wiki, page) => {
      parseCalls.push({ kind: 'team', wiki, page });
      return {
        name: page.replace(/_/g, ' '),
        image: `https://liquipedia.net/img/${page}.png`,
        facts: { location: 'Saudi Arabia', region: 'MENA' },
        normalized: { location: 'Saudi Arabia' },
        roster: [
          { name: `${page} Star`, page: `${page}_Star`, role: 'Player' },
          { name: `${page} Two`, page: `${page}_Two`, role: null },
        ],
        raw: '<div class="fo-nttax-infobox">…</div>',
      };
    },
    fetchPlayerEntity: async (wiki, page) => {
      parseCalls.push({ kind: 'player', wiki, page });
      return {
        name: page.replace(/_/g, ' '),
        image: `https://liquipedia.net/img/${page}.jpg`,
        facts: { nationality: 'France' },
        normalized: { nationality: 'France', role: null, romanizedName: 'Evan Rogez' },
        raw: '<div class="fo-nttax-infobox">…</div>',
      };
    },
  };
}

test.before(async () => {
  // A battle-royale-adjacent game (rocketleague) + TFT: no PandaScore rows exist.
  const rl = await addTournament({
    source: 'liquipedia', external_id: 'rl/major', game: 'rocketleague',
    name: 'RL Major', url: 'https://liquipedia.net/rocketleague/Major', guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: rl.id, source: 'liquipedia', external_id: 'Match:rl-1',
    team_a: 'Twisted Minds', team_b: 'Unknown Squad', status: 'scheduled',
  });
  await upsertMatch({
    tournament_id: rl.id, source: 'liquipedia', external_id: 'Match:rl-2',
    team_a: 'TBD', team_b: 'Twisted Minds', status: 'scheduled',
  });

  // A PandaScore-covered game with an EXISTING row: must be reused, not duplicated.
  const val = await addTournament({
    source: 'liquipedia', external_id: 'val/cup', game: 'valorant',
    name: 'Val Cup', url: 'https://liquipedia.net/valorant/Cup', guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: val.id, source: 'liquipedia', external_id: 'Match:val-1',
    team_a: 'Team Falcons', team_b: 'TBD', status: 'scheduled',
  });
  await upsertTeam({ game: 'valorant', pandascore_id: 900, name: 'Team Falcons', slug: 'team-falcons' });
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('creates Liquipedia-only entities for uncovered games and enriches them', async () => {
  const parseCalls = [];
  const summary = await runLiquipediaEnrichment({ liquipedia: mockLiquipedia({ parseCalls }), maxParses: 50 });

  assert.ok(summary.teamsParsed >= 2); // Twisted Minds (rl) + Team Falcons (val)
  assert.ok(summary.playersParsed >= 2);
  assert.ok(summary.misses >= 1); // Unknown Squad stamped as a miss

  const rlTeams = await listTeams({ game: 'rocketleague', limit: 50 });
  const twisted = rlTeams.find((t) => t.name === 'Twisted Minds');
  assert.ok(twisted, 'BR team created without a PandaScore id');
  assert.equal(twisted.pandascore_id, null);
  assert.equal(twisted.location, 'Saudi Arabia');
  assert.match(twisted.liquipedia_url, /rocketleague\/Twisted_Minds/);
  assert.ok(twisted.liquipedia_parsed_at);
  assert.ok(JSON.parse(twisted.liquipedia_facts).region === 'MENA');

  const rlPlayers = await listPlayers({ game: 'rocketleague', limit: 50 });
  const star = rlPlayers.find((p) => p.name === 'Twisted_Minds Star');
  assert.ok(star, 'roster player created');
  assert.equal(star.current_team_id, twisted.id);
  assert.equal(star.nationality, 'France');
  assert.equal(star.first_name, 'Evan');
  assert.equal(star.last_name, 'Rogez');

  // Placeholder TBD never became an entity.
  assert.ok(!rlTeams.some((t) => t.name === 'TBD'));
});

test('reuses the existing PandaScore row instead of duplicating', async () => {
  const valTeams = await listTeams({ game: 'valorant', limit: 50 });
  const falcons = valTeams.filter((t) => t.name.toLowerCase().includes('falcons'));
  assert.equal(falcons.length, 1); // enriched in place, no duplicate
  assert.equal(falcons[0].pandascore_id, 900);
  assert.ok(falcons[0].liquipedia_parsed_at);
});

test('fresh entities are skipped on the next run (TTL)', async () => {
  const parseCalls = [];
  const summary = await runLiquipediaEnrichment({ liquipedia: mockLiquipedia({ parseCalls }), maxParses: 50 });
  assert.equal(summary.teamsParsed, 0);
  assert.equal(summary.playersParsed, 0);
  assert.ok(summary.skippedFresh >= 2);
  // Misses are stamped too: Unknown Squad must NOT be re-searched.
  const resolveCalls = [];
  await runLiquipediaEnrichment({ liquipedia: mockLiquipedia({ resolveCalls }), maxParses: 50 });
  assert.ok(!resolveCalls.some((c) => c.name === 'Unknown Squad'));
});

test('the parse budget caps a run', async () => {
  const parseCalls = [];
  // Expired TTL forces re-parsing everything; budget 1 stops after one parse.
  const summary = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls }),
    maxParses: 1,
    ttlMs: 0,
  });
  assert.equal(parseCalls.length, 1);
  assert.equal(summary.teamsParsed + summary.playersParsed, 1);
});
