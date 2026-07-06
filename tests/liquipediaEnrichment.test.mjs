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
const { addTournament, listActiveTournaments } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { upsertTeam, listTeams, saveTeamLiquipedia, createLiquipediaTeam } = await import('../src/db/teams.js');
const { listPlayers, upsertPlayer, getPlayerByPandaScoreId, savePlayerLiquipedia } = await import('../src/db/players.js');
const { replaceTournamentStandings, listStandingsTeamNamesForGame } = await import(
  '../src/db/tournamentStandings.js'
);
const { runLiquipediaEnrichment } = await import('../src/jobs/liquipediaEnrichment.js');
const { run: runDb } = await import('../src/db/client.js');

const GUILD = 'guild-lp';

function mockLiquipedia({
  resolveCalls = [],
  parseCalls = [],
  transientNames = [],
  supportedGames = ['rocketleague', 'tft', 'valorant'],
} = {}) {
  const supported = new Set(supportedGames);
  return {
    wikiForGame: (game) => (supported.has(game) ? game : null),
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
        raw: '<div class="fo-nttax-infobox">...</div><table class="table2__table"></table>',
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

test('old rosterless raw bypasses freshness once for roster backfill', async () => {
  const tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'backfill/cup',
    game: 'backfill',
    name: 'Backfill Cup',
    url: 'https://liquipedia.net/backfill/Cup',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:backfill-1',
    team_a: 'Rosterless Old Raw',
    team_b: 'TBD',
    status: 'scheduled',
  });
  const team = await upsertTeam({
    game: 'backfill',
    pandascore_id: 8100,
    name: 'Rosterless Old Raw',
    slug: 'rosterless-old-raw',
  });
  await saveTeamLiquipedia(team.id, {
    url: 'https://liquipedia.net/backfill/Rosterless_Old_Raw',
    raw: '<div class="fo-nttax-infobox">old parser stored only the infobox</div>',
    facts: { region: 'Old' },
  });

  const parseCalls = [];
  const summary = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls, supportedGames: ['backfill'] }),
    maxParses: 10,
    rosterBackfillBefore: '2999-01-01T00:00:00Z',
  });

  assert.equal(summary.rosterBackfilled, 1);
  assert.ok(parseCalls.some((call) => call.kind === 'team' && call.page === 'Rosterless_Old_Raw'));

  const secondParseCalls = [];
  const second = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls: secondParseCalls, supportedGames: ['backfill'] }),
    maxParses: 10,
    rosterBackfillBefore: '2999-01-01T00:00:00Z',
  });

  assert.equal(second.rosterBackfilled, 0);
  assert.ok(!secondParseCalls.some((call) => call.kind === 'team'));
});

test('player page enrichment resumes from stored roster links after budget cutoff', async () => {
  const tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'resume/cup',
    game: 'resume',
    name: 'Resume Cup',
    url: 'https://liquipedia.net/resume/Cup',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:resume-1',
    team_a: 'Resume Squad',
    team_b: 'TBD',
    status: 'scheduled',
  });

  const firstParseCalls = [];
  await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls: firstParseCalls, supportedGames: ['resume'] }),
    maxParses: 2,
  });
  assert.deepEqual(firstParseCalls.map((call) => call.kind), ['team']);

  const pendingPlayers = await listPlayers({ game: 'resume', limit: 50 });
  const star = pendingPlayers.find((player) => player.name === 'Resume_Squad Star');
  assert.ok(star, 'roster player was created before player-page budget was available');
  assert.match(star.liquipedia_url, /resume\/Resume_Squad_Star$/);
  assert.equal(star.liquipedia_parsed_at, null);

  const secondParseCalls = [];
  const summary = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls: secondParseCalls, supportedGames: ['resume'] }),
    maxParses: 1,
  });

  assert.equal(summary.teamsParsed, 0);
  assert.equal(summary.playersParsed, 1);
  assert.deepEqual(secondParseCalls, [{ kind: 'player', wiki: 'resume', page: 'Resume_Squad_Star' }]);
});

test('fresh Liquipedia players missing a portrait get one image backfill pass', async () => {
  const tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'imagebackfill/cup',
    game: 'imagebackfill',
    name: 'Image Backfill Cup',
    url: 'https://liquipedia.net/imagebackfill/Cup',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:image-backfill-1',
    team_a: 'Image Squad',
    team_b: 'TBD',
    status: 'scheduled',
  });
  const team = await upsertTeam({
    game: 'imagebackfill',
    pandascore_id: 8200,
    name: 'Image Squad',
    slug: 'image-squad',
  });
  await saveTeamLiquipedia(team.id, {
    url: 'https://liquipedia.net/imagebackfill/Image_Squad',
    raw: '<div class="fo-nttax-infobox">...</div><table class="table2__table"></table>',
    facts: { region: 'Fresh' },
  });
  const player = await upsertPlayer({
    game: 'imagebackfill',
    pandascore_id: 8201,
    name: 'Image_Squad Star',
    current_team_id: team.id,
    current_team_name: 'Image Squad',
  });
  await savePlayerLiquipedia(player.id, {
    url: 'https://liquipedia.net/imagebackfill/Image_Squad_Star',
    facts: { nationality: 'Brazil' },
  });

  const firstParseCalls = [];
  const first = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls: firstParseCalls, supportedGames: ['imagebackfill'] }),
    maxParses: 5,
    playerImageBackfillBefore: '2999-01-01T00:00:00Z',
  });

  assert.equal(first.teamsParsed, 0);
  assert.equal(first.playersParsed, 1);
  assert.equal(first.playerImageBackfilled, 1);
  assert.deepEqual(firstParseCalls, [{ kind: 'player', wiki: 'imagebackfill', page: 'Image_Squad_Star' }]);
  const withImage = (await listPlayers({ game: 'imagebackfill', limit: 10 })).find((p) => p.id === player.id);
  assert.equal(withImage.image_url, 'https://liquipedia.net/img/Image_Squad_Star.jpg');

  const secondParseCalls = [];
  const second = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls: secondParseCalls, supportedGames: ['imagebackfill'] }),
    maxParses: 5,
    playerImageBackfillBefore: '2999-01-01T00:00:00Z',
  });

  assert.equal(second.playersParsed, 0);
  assert.deepEqual(secondParseCalls, []);
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

test('lobby schedule rows are not searched as team entities', async () => {
  const tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'schedulejunk/cup',
    game: 'schedulejunk',
    name: 'Schedule Junk Cup',
    url: 'https://liquipedia.net/schedulejunk/Cup',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:schedule-junk-real',
    team_a: 'Actual Squad',
    team_b: 'Grand Finals - Game 3',
    status: 'scheduled',
  });
  await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:schedule-junk-lobby',
    team_a: 'Survival Stage - Match',
    team_b: 'Lobby',
    status: 'scheduled',
  });
  await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:schedule-junk-real-match-name',
    team_a: 'The Match',
    team_b: 'TBD',
    status: 'scheduled',
  });

  const resolveCalls = [];
  await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ resolveCalls, supportedGames: ['schedulejunk'] }),
    maxParses: 20,
    ttlMs: 0,
  });

  const names = resolveCalls.map((call) => call.name);
  assert.deepEqual(names, ['Actual Squad', 'The Match']);
});

test('junk schedule-row team stubs from earlier runs are deleted (real rows kept)', async () => {
  // Rows the job created from schedule names BEFORE the isScheduleRowName filter
  // existed: Liquipedia-created stubs (no PandaScore id, no parsed data). Prod
  // accumulated 62 of these for pubgmobile alone.
  const junk1 = await createLiquipediaTeam({ game: 'schedulejunk', name: 'Grand Finals - Game 7', slug: 'gf-g7' });
  const junk2 = await createLiquipediaTeam({ game: 'schedulejunk', name: 'Survival Stage - Match', slug: 'ss-m' });
  // Junk-looking NAME but with parsed data: never deleted (could be a real page).
  const enriched = await createLiquipediaTeam({ game: 'schedulejunk', name: 'Odd Game 9', slug: 'odd-game-9' });
  await saveTeamLiquipedia(enriched.id, { url: 'https://liquipedia.net/schedulejunk/Odd', raw: '<div/>', facts: {} });

  const summary = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ supportedGames: ['schedulejunk'] }),
    maxParses: 20,
  });
  assert.ok(summary.junkDeleted >= 2, `junk stubs deleted (got ${summary.junkDeleted})`);

  const teams = await listTeams({ game: 'schedulejunk', limit: 100 });
  const names = teams.map((t) => t.name);
  assert.ok(!names.includes('Grand Finals - Game 7'), 'stub deleted');
  assert.ok(!names.includes('Survival Stage - Match'), 'stub deleted');
  assert.ok(names.includes('Odd Game 9'), 'row with parsed data kept');
  assert.ok(names.includes('Actual Squad'), 'real team kept');

  // Second run: nothing left to delete (idempotent).
  const again = await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ supportedGames: ['schedulejunk'] }),
    maxParses: 20,
  });
  assert.equal(again.junkDeleted, 0);
});

test('EWC games consume enrichment budget before other active games', async () => {
  const ewc = await addTournament({
    source: 'liquipedia',
    external_id: 'ewcpriority/Esports_World_Cup/2026',
    game: 'ewcpriority',
    name: 'Esports World Cup 2026 Priority',
    url: 'https://liquipedia.net/ewcpriority/Esports_World_Cup/2026',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: ewc.id,
    source: 'liquipedia',
    external_id: 'Match:ewc-priority',
    team_a: 'EWC Priority',
    team_b: 'TBD',
    status: 'scheduled',
  });
  const other = await addTournament({
    source: 'liquipedia',
    external_id: 'otherpriority/cup',
    game: 'otherpriority',
    name: 'Other Priority Cup',
    url: 'https://liquipedia.net/otherpriority/Cup',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: other.id,
    source: 'liquipedia',
    external_id: 'Match:other-priority',
    team_a: 'Non EWC Priority',
    team_b: 'TBD',
    status: 'scheduled',
  });

  const parseCalls = [];
  const resolveCalls = [];
  await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls, resolveCalls, supportedGames: ['ewcpriority', 'otherpriority'] }),
    maxParses: 2,
    random: () => 0,
  });

  assert.deepEqual(parseCalls, [{ kind: 'team', wiki: 'ewcpriority', page: 'EWC_Priority' }]);
  assert.ok(!resolveCalls.some((call) => call.name === 'Non EWC Priority'));
});

test('EWC roster player pages run before non-EWC teams in the same game', async () => {
  const ewc = await addTournament({
    source: 'liquipedia',
    external_id: 'samepriority/Esports_World_Cup/2026',
    game: 'samepriority',
    name: 'Esports World Cup 2026 Same Game',
    url: 'https://liquipedia.net/samepriority/Esports_World_Cup/2026',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: ewc.id,
    source: 'liquipedia',
    external_id: 'Match:same-priority-ewc',
    team_a: 'EWC Same',
    team_b: 'TBD',
    status: 'scheduled',
  });
  const other = await addTournament({
    source: 'liquipedia',
    external_id: 'samepriority/weekly',
    game: 'samepriority',
    name: 'Same Priority Weekly',
    url: 'https://liquipedia.net/samepriority/Weekly',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: other.id,
    source: 'liquipedia',
    external_id: 'Match:same-priority-other',
    team_a: 'Other Same',
    team_b: 'TBD',
    status: 'scheduled',
  });

  const parseCalls = [];
  const resolveCalls = [];
  await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ parseCalls, resolveCalls, supportedGames: ['samepriority'] }),
    maxParses: 3,
  });

  assert.deepEqual(parseCalls, [
    { kind: 'team', wiki: 'samepriority', page: 'EWC_Same' },
    { kind: 'player', wiki: 'samepriority', page: 'EWC_Same_Star' },
  ]);
  assert.ok(!resolveCalls.some((call) => call.name === 'Other Same'));
});

test('least-recently-enriched game wins the budget over a freshly-enriched one', async () => {
  // "lrufresh" was fully enriched moments ago; "lrustale" has an old parse.
  // Regardless of shuffle luck, the stale game must be processed first — this is
  // what gets a starved game (prod: LoL) its turn deterministically.
  const staleT = await addTournament({
    source: 'liquipedia', external_id: 'lrustale/cup', game: 'lrustale',
    name: 'LRU Stale Cup', url: 'https://liquipedia.net/lrustale/Cup', guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: staleT.id, source: 'liquipedia', external_id: 'Match:lru-stale',
    team_a: 'Stale Squad', team_b: 'TBD', status: 'scheduled',
  });
  const freshT = await addTournament({
    source: 'liquipedia', external_id: 'lrufresh/cup', game: 'lrufresh',
    name: 'LRU Fresh Cup', url: 'https://liquipedia.net/lrufresh/Cup', guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: freshT.id, source: 'liquipedia', external_id: 'Match:lru-fresh',
    team_a: 'Fresh Squad', team_b: 'TBD', status: 'scheduled',
  });

  // Give both games a parsed team so neither counts as "never enriched", with
  // the stale game's stamp far in the past.
  const staleTeam = await createLiquipediaTeam({ game: 'lrustale', name: 'Stale Squad', slug: 'stale-squad' });
  await saveTeamLiquipedia(staleTeam.id, { url: 'https://liquipedia.net/lrustale/Stale_Squad', raw: '<table class="table2__table"/>', facts: {} });
  await runDb("UPDATE teams SET liquipedia_parsed_at = '2026-01-01 00:00:00' WHERE id = $1", [staleTeam.id]);
  const freshTeam = await createLiquipediaTeam({ game: 'lrufresh', name: 'Fresh Squad', slug: 'fresh-squad' });
  await saveTeamLiquipedia(freshTeam.id, { url: 'https://liquipedia.net/lrufresh/Fresh_Squad', raw: '<table class="table2__table"/>', facts: {} });

  const parseCalls = [];
  // Try both extreme shuffle outcomes: ordering must not depend on them.
  for (const randomValue of [0, 0.99]) {
    parseCalls.length = 0;
    await runLiquipediaEnrichment({
      liquipedia: mockLiquipedia({ parseCalls, supportedGames: ['lrustale', 'lrufresh'] }),
      maxParses: 2,
      ttlMs: 0,
      random: () => randomValue,
    });
    assert.equal(parseCalls[0]?.wiki, 'lrustale', `stale game first (random=${randomValue})`);
  }
});

test('game order is shuffled before a small budget cuts the run off', async () => {
  const first = await addTournament({
    source: 'liquipedia',
    external_id: 'shufflea/cup',
    game: 'shufflea',
    name: 'Shuffle A Cup',
    url: 'https://liquipedia.net/shufflea/Cup',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: first.id,
    source: 'liquipedia',
    external_id: 'Match:shuffle-a',
    team_a: 'Alpha Shuffle',
    team_b: 'TBD',
    status: 'scheduled',
  });
  const second = await addTournament({
    source: 'liquipedia',
    external_id: 'shuffleb/cup',
    game: 'shuffleb',
    name: 'Shuffle B Cup',
    url: 'https://liquipedia.net/shuffleb/Cup',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: second.id,
    source: 'liquipedia',
    external_id: 'Match:shuffle-b',
    team_a: 'Beta Shuffle',
    team_b: 'TBD',
    status: 'scheduled',
  });

  const supportedGames = ['shufflea', 'shuffleb'];
  const initialOrder = [
    ...new Set((await listActiveTournaments()).map((t) => t.game).filter((game) => supportedGames.includes(game))),
  ];
  assert.equal(initialOrder.length, 2);

  const parseCalls = [];
  const resolveCalls = [];
  await runLiquipediaEnrichment({
    liquipedia: mockLiquipedia({ resolveCalls, parseCalls, supportedGames }),
    maxParses: 2,
    ttlMs: 0,
    random: () => 0,
  });

  assert.equal(resolveCalls[0].wiki, initialOrder[1]);
  assert.equal(parseCalls[0].wiki, initialOrder[1]);
});
