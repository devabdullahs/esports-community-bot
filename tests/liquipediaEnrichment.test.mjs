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
const { listPlayers, upsertPlayer, getPlayerByPandaScoreId } = await import('../src/db/players.js');
const { replaceTournamentStandings, listStandingsTeamNamesForGame } = await import(
  '../src/db/tournamentStandings.js'
);
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

  // A standings-format TFT event: its participants live in tournament_standings,
  // NOT in matches, so they must still enter the enrichment's tracked scene.
  const tft = await addTournament({
    source: 'liquipedia', external_id: 'tft/groups', game: 'tft',
    name: 'TFT Groups', url: 'https://liquipedia.net/tft/Groups', guild_id: GUILD,
  });
  await replaceTournamentStandings(tft.id, [
    { title: 'Group A', entries: [
      { rank: 1, team: 'Standings Squad', points: '', logo: null },
      { rank: 2, team: 'TBD', points: '', logo: null },
    ] },
  ]);
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

test('enriches battle-royale/TFT standings participants, not just match teams', async () => {
  // "Standings Squad" appears only in tournament_standings (no match), so it is
  // in scope only if the enrichment unions the standings participants.
  const names = await listStandingsTeamNamesForGame('tft');
  assert.deepEqual(names, ['Standings Squad']); // TBD excluded

  const tftTeams = await listTeams({ game: 'tft', limit: 50 });
  const squad = tftTeams.find((t) => t.name === 'Standings Squad');
  assert.ok(squad, 'standings-only participant became a team');
  assert.ok(squad.liquipedia_parsed_at, 'and was enriched from Liquipedia');
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

test('a parsed roster verifies existing players and clears dropped ones (Liquipedia beats stale PandaScore)', async () => {
  // TFT scene: PandaScore already knows the team and two players. Liquipedia's
  // roster still lists "Star" but NOT "OldGuy" — he transferred away long ago
  // and PandaScore never noticed (the Abo Makkah case).
  const tft = await addTournament({
    source: 'liquipedia', external_id: 'tft/open', game: 'tft',
    name: 'TFT Open', url: 'https://liquipedia.net/tft/Open', guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: tft.id, source: 'liquipedia', external_id: 'Match:tft-1',
    team_a: 'Nova Esports', team_b: 'TBD', status: 'scheduled',
  });
  const nova = await upsertTeam({ game: 'tft', pandascore_id: 700, name: 'Nova Esports', slug: 'nova-esports' });
  await upsertPlayer({
    game: 'tft', pandascore_id: 7001, name: 'Nova_Esports Star',
    current_team_id: nova.id, current_team_pandascore_id: 700, current_team_name: 'Nova Esports',
  });
  await upsertPlayer({
    game: 'tft', pandascore_id: 7002, name: 'OldGuy',
    current_team_id: nova.id, current_team_pandascore_id: 700, current_team_name: 'Nova Esports',
  });

  await runLiquipediaEnrichment({ liquipedia: mockLiquipedia(), maxParses: 50 });

  const star = await getPlayerByPandaScoreId(7001);
  assert.equal(star.current_team_id, nova.id); // confirmed by the roster
  assert.ok(star.current_team_verified_at);

  const oldGuy = await getPlayerByPandaScoreId(7002);
  assert.equal(oldGuy.current_team_id, null); // dropped: gone from the roster
  assert.equal(oldGuy.current_team_name, null);
  assert.ok(oldGuy.current_team_verified_at); // …and protected against re-adds

  // A later stale PandaScore sync must not revert either player.
  await upsertPlayer({
    game: 'tft', pandascore_id: 7002, name: 'OldGuy',
    current_team_id: nova.id, current_team_pandascore_id: 700, current_team_name: 'Nova Esports',
    image_url: 'https://cdn.pandascore.co/oldguy.png',
  });
  const oldGuyAfter = await getPlayerByPandaScoreId(7002);
  assert.equal(oldGuyAfter.current_team_id, null); // verified team survives
  assert.equal(oldGuyAfter.image_url, 'https://cdn.pandascore.co/oldguy.png'); // bio fields still flow

  await upsertPlayer({
    game: 'tft', pandascore_id: 7001, name: 'Nova_Esports Star',
    current_team_id: null, current_team_pandascore_id: 999, current_team_name: 'Stale FC',
  });
  const starAfter = await getPlayerByPandaScoreId(7001);
  assert.equal(starAfter.current_team_id, nova.id);
  assert.equal(starAfter.current_team_name, 'Nova Esports');
});

test('a truncated roster parse never clears players (absence is only meaningful when complete)', async () => {
  // The parser caps roster rows; a capped parse means "these players are on the
  // team", not "everyone else left". Nova_Esports Two is verified on the team
  // from the previous run — a truncated re-parse that omits him must keep him.
  const lp = mockLiquipedia();
  const fullFetch = lp.fetchTeamEntity;
  lp.fetchTeamEntity = async (wiki, page) => {
    const entity = await fullFetch(wiki, page);
    return { ...entity, roster: entity.roster.slice(0, 1), rosterTruncated: true };
  };
  await runLiquipediaEnrichment({ liquipedia: lp, maxParses: 50, ttlMs: 0 });

  const tftPlayers = await listPlayers({ game: 'tft', limit: 50 });
  const two = tftPlayers.find((p) => p.name === 'Nova_Esports Two');
  assert.ok(two, 'roster player exists from the previous complete parse');
  assert.ok(two.current_team_id, 'still on the team despite the truncated parse');
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
