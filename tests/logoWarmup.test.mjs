import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'logo-warmup-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { addTournament, archiveTournament } = await import('../src/db/tournaments.js');
const { upsertMatch, listTrackedMatchLogos } = await import('../src/db/matches.js');
const { replaceTournamentStandings, listStandingsLogos } = await import('../src/db/tournamentStandings.js');
const { upsertTeam, createLiquipediaTeam, saveTeamLiquipedia, listLiquipediaTeamLogos } = await import(
  '../src/db/teams.js'
);
const { createLiquipediaPlayer, savePlayerLiquipedia, listPriorityLiquipediaPlayerLogos } = await import(
  '../src/db/players.js'
);
const { warmTrackedMatchLogos } = await import('../src/jobs/logoWarmup.js');

const GUILD = 'guild-warmup';
const A = 'https://liquipedia.net/commons/images/a.png';
const B = 'https://liquipedia.net/commons/images/b.png';
const C = 'https://liquipedia.net/commons/images/c.png';
const OLD = 'https://liquipedia.net/commons/images/aa-old.png';
const LIVE = 'https://liquipedia.net/commons/images/zz-live.png';
const Z = 'https://liquipedia.net/commons/images/z.png';

test.before(async () => {
  const active = await addTournament({
    source: 'liquipedia',
    external_id: 'warmup/active',
    game: 'valorant',
    name: 'Active Event',
    url: 'https://liquipedia.net/valorant/Active',
    guild_id: GUILD,
  });
  // Two matches; A appears on both so the distinct set is {A, B, C}.
  await upsertMatch({
    tournament_id: active.id,
    source: 'liquipedia',
    external_id: 'Match:warmup-1',
    team_a: 'Alpha',
    team_b: 'Bravo',
    logo_a: A,
    logo_b: B,
    status: 'scheduled',
  });
  await upsertMatch({
    tournament_id: active.id,
    source: 'liquipedia',
    external_id: 'Match:warmup-2',
    team_a: 'Alpha',
    team_b: 'Charlie',
    logo_a: A,
    logo_b: C,
    status: 'scheduled',
  });
  await upsertMatch({
    tournament_id: active.id,
    source: 'liquipedia',
    external_id: 'Match:warmup-live',
    team_a: 'Live Team',
    team_b: 'Opponent',
    logo_a: LIVE,
    logo_b: null,
    status: 'running',
    scheduled_at: Math.floor(Date.now() / 1000) - 60,
  });
  await upsertMatch({
    tournament_id: active.id,
    source: 'liquipedia',
    external_id: 'Match:warmup-old',
    team_a: 'Old Team',
    team_b: 'Opponent',
    logo_a: OLD,
    logo_b: null,
    status: 'finished',
    scheduled_at: Math.floor(Date.now() / 1000) - 20 * 24 * 60 * 60,
  });

  // Archived tournament: its crest (Z) must never be warmed.
  const archived = await addTournament({
    source: 'liquipedia',
    external_id: 'warmup/archived',
    game: 'valorant',
    name: 'Archived Event',
    url: 'https://liquipedia.net/valorant/Archived',
    guild_id: GUILD,
  });
  await upsertMatch({
    tournament_id: archived.id,
    source: 'liquipedia',
    external_id: 'Match:warmup-archived',
    team_a: 'Yankee',
    team_b: 'Zulu',
    logo_a: Z,
    logo_b: null,
    status: 'finished',
  });
  await archiveTournament(archived.id, GUILD, Math.floor(Date.now() / 1000));
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('listTrackedMatchLogos returns distinct active crests and excludes archived ones', async () => {
  const logos = await listTrackedMatchLogos();
  assert.deepEqual(logos, [LIVE, A, B, C, OLD]); // live first, old last, no Z from the archived event
});

test('warms each distinct active crest exactly once through the loader', async () => {
  const calls = [];
  const load = async (url, channel, options) => {
    calls.push({ url, channel, options });
    return { cached: false, bytes: Buffer.from([0x89]), file: '' };
  };

  const summary = await warmTrackedMatchLogos({ load });

  assert.equal(summary.total, 5);
  assert.equal(summary.warmed, 5);
  assert.equal(summary.downloaded, 5);
  assert.equal(summary.cached, 0);
  assert.deepEqual(
    calls.map((c) => c.url).sort(),
    [A, B, C, LIVE, OLD].sort(),
  );
  // Every call uses the bot download channel and asks the cache to download misses.
  assert.ok(calls.every((c) => c.channel === 'bot' && c.options?.download === true));
  assert.ok(!calls.some((c) => c.url === Z));
});

test('stops once the per-run download cap is reached', async () => {
  const calls = [];
  const load = async (url) => {
    calls.push(url);
    return { cached: false, bytes: Buffer.from([0x89]), file: '' };
  };

  const summary = await warmTrackedMatchLogos({ load, maxDownloads: 2 });

  assert.equal(summary.downloaded, 2);
  assert.equal(calls.length, 2); // breaks before attempting the third crest
});

test('already-cached crests do not count against the download cap', async () => {
  const calls = [];
  const load = async (url) => {
    calls.push(url);
    return { cached: true, bytes: Buffer.from([0x89]), file: '' };
  };

  const summary = await warmTrackedMatchLogos({ load, maxDownloads: 1 });

  assert.equal(summary.cached, 5);
  assert.equal(summary.downloaded, 0);
  assert.equal(calls.length, 5); // cap is for fresh downloads only
});

test('a loader error is counted as a miss without aborting the run', async () => {
  const load = async (url) => {
    if (url === B) throw new Error('logo downloads backing off after a rate limit');
    return { cached: false, bytes: Buffer.from([0x89]), file: '' };
  };

  const summary = await warmTrackedMatchLogos({ load });

  assert.equal(summary.warmed, 4); // every crest except B
  assert.equal(summary.failed, 1); // B threw
});

// Placed last: it adds standings + entity rows, which would change the crest
// counts the strict-count tests above assert on.
test('warmup also collects standings + Liquipedia entity logos, but not PandaScore CDN images', async () => {
  const SLOGO = 'https://liquipedia.net/commons/images/standings-team.png';
  const TLOGO = 'https://liquipedia.net/commons/images/lp-team.png';
  const PLOGO = 'https://liquipedia.net/commons/images/lp-player.jpg';
  const CDN = 'https://cdn.pandascore.co/images/team/image/9/logo.png';

  // Active tournament with a battle-royale standings row (Liquipedia crest).
  const br = await addTournament({
    source: 'liquipedia', external_id: 'pubg/Esports_World_Cup/2026/Warmup_BR', game: 'pubg',
    name: 'Esports World Cup BR Event', url: 'https://liquipedia.net/pubg/Event', guild_id: GUILD,
  });
  await replaceTournamentStandings(br.id, [
    { title: '', entries: [{ rank: 1, team: 'Standings Team', points: '100', logo: SLOGO }] },
  ]);

  // A Liquipedia-only team (crest must warm) + a PandaScore team (CDN crest must NOT).
  const lpTeam = await createLiquipediaTeam({ game: 'pubg', name: 'LP Team', slug: 'lp-team' });
  await saveTeamLiquipedia(lpTeam.id, { url: 'https://liquipedia.net/pubg/LP_Team', image: TLOGO });
  const lpPlayer = await createLiquipediaPlayer({
    game: 'pubg',
    name: 'LP Player',
    slug: 'lp-player',
    currentTeamId: lpTeam.id,
    currentTeamName: 'Standings Team',
    liquipediaUrl: 'https://liquipedia.net/pubg/LP_Player',
  });
  await savePlayerLiquipedia(lpPlayer.id, { url: 'https://liquipedia.net/pubg/LP_Player', image: PLOGO });
  await upsertTeam({ game: 'pubg', pandascore_id: 5150, name: 'CDN Team', slug: 'cdn-team', image_url: CDN });

  assert.deepEqual(await listStandingsLogos(), [SLOGO]);
  assert.deepEqual((await listLiquipediaTeamLogos()).sort(), [TLOGO].sort());
  assert.deepEqual(await listPriorityLiquipediaPlayerLogos(), [PLOGO]);

  const seen = [];
  await warmTrackedMatchLogos({
    load: async (url) => {
      seen.push(url);
      return { cached: false, bytes: Buffer.from([0x89]), file: '' };
    },
    maxDownloads: 100,
  });
  assert.ok(seen.includes(SLOGO), 'standings crest warmed');
  assert.ok(seen.includes(TLOGO), 'Liquipedia team crest warmed');
  assert.ok(seen.includes(PLOGO), 'priority Liquipedia player portrait warmed');
  assert.ok(!seen.includes(CDN), 'PandaScore CDN crest never sent to the Liquipedia cache');
});
