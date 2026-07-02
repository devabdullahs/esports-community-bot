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

function mockLiquipedia({ resolveCalls = [], parseCalls = [], transientNames = [] } = {}) {
  return {
    wikiForGame: (game) => (['rocketleague', 'tft', 'valorant'].includes(game) ? game : null),
    pageFromUrl: (url) => {
      if (!url) return null;
      const segments = String(url).split('/').filter(Boolean);
      return segments.length >= 3 ? segments.slice(3).join('/') : null;
    },
    resolveEntityPage: async (wiki, name) => {
      resolveCalls.push({ wiki, name });
      if (transientNames.includes(name)) return { status: 'transient' };
      if (name === 'Unknown Squad') return { status: 'no-match' };
      const page = name.replace(/ /g, '_');
      return { status: 'ok', title: name, page, url: `https://liquipedia.net/${wiki}/${page}` };
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

test('the request budget caps a run (refreshes reuse the stored page, no search)', async () => {
  const parseCalls = [];
  const resolveCalls = [];
  // Expired TTL forces refreshing everything; already-resolved teams have a
  // stored liquipedia_url, so the refresh skips the search and budget 1 buys
  // exactly one parse.
  const summary = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls, resolveCalls }),
    maxParses: 1,
    ttlMs: 0,
  });
  assert.equal(parseCalls.length, 1);
  assert.equal(summary.teamsParsed + summary.playersParsed, 1);
  assert.ok(!resolveCalls.some((c) => c.name === 'Twisted Minds')); // refresh went straight to parse
});

test('transient search failures are never stamped as misses', async () => {
  // New team whose search hits a backoff/queue-full empty result.
  const rl2 = await addTournament({
    source: 'liquipedia', external_id: 'rl/minor', game: 'rocketleague',
    name: 'RL Minor', url: 'https://liquipedia.net/rocketleague/Minor', guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: rl2.id, source: 'liquipedia', external_id: 'Match:rl-3',
    team_a: 'Flaky Team', team_b: 'TBD', status: 'scheduled',
  });

  await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ transientNames: ['Flaky Team'] }),
    maxParses: 50,
    ttlMs: 0,
  });
  const teams = await listTeams({ game: 'rocketleague', q: 'flaky', limit: 10 });
  assert.equal(teams.length, 1);
  assert.equal(teams[0].liquipedia_parsed_at, null); // NOT stamped — retried next run

  // Next run without the transient failure resolves it normally.
  const resolveCalls = [];
  await runLiquipediaEnrichment({ liquipedia: mockLiquipedia({ resolveCalls }), maxParses: 50, ttlMs: 0 });
  assert.ok(resolveCalls.some((c) => c.name === 'Flaky Team'));
});

test('a later PandaScore sync adopts the Liquipedia-only row instead of duplicating', async () => {
  // "Twisted Minds" exists as a Liquipedia-only rocketleague row (pandascore_id NULL,
  // slug = normalized name). A PandaScore upsert for the same team must claim it.
  const adopted = await upsertTeam({
    game: 'rocketleague',
    pandascore_id: 4242,
    name: 'Twisted Minds',
    slug: 'twisted-minds-rl',
    image_url: 'https://cdn.pandascore.co/tm.png',
  });
  const rlTeams = await listTeams({ game: 'rocketleague', q: 'twisted', limit: 10 });
  assert.equal(rlTeams.length, 1); // still ONE identity
  assert.equal(rlTeams[0].id, adopted.id);
  assert.equal(rlTeams[0].pandascore_id, 4242);
  assert.ok(rlTeams[0].liquipedia_parsed_at); // Liquipedia enrichment preserved
});
