import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { run, closeDbClient } = await import('../src/db/client.js');
const {
  deleteTournamentPlaceholderMatches,
  dedupeMatches,
  getActiveMatches,
  getMatch,
  getMatchesForGuild,
  markStaleActiveFinished,
  upsertMatch,
} = await import('../src/db/matches.js');
const { normalizeTeamName } = await import('../src/lib/render.js');

test('normalizeTeamName resolves known Liquipedia short-name redirects', () => {
  assert.equal(normalizeTeamName('PTime'), 'playtime');
  assert.equal(normalizeTeamName('PlayTime'), 'playtime');
  assert.equal(normalizeTeamName('L1 TEAM'), 'l1gateam');
  assert.equal(normalizeTeamName('L1GA TEAM'), 'l1gateam');
});

test('dedupeMatches collapses live-widget alias rows by timestamp and shared team', () => {
  const scheduledAt = 1_783_427_100;
  const rows = [
    {
      id: 1,
      tournament_id: 10,
      game: 'dota2',
      external_id: 'dota2:1783427100:Team Liquid:PTime',
      team_a: 'Team Liquid',
      team_b: 'PTime',
      score_a: 1,
      score_b: 0,
      status: 'running',
      scheduled_at: scheduledAt,
    },
    {
      id: 2,
      tournament_id: 10,
      game: 'dota2',
      external_id: 'dota2:Esports_World_Cup/2026/Group_Stage:matchlist:15:playtime vs team liquid',
      team_a: 'Team Liquid',
      team_b: 'PlayTime',
      score_a: 1,
      score_b: 0,
      status: 'running',
      scheduled_at: scheduledAt,
    },
    {
      id: 3,
      tournament_id: 10,
      game: 'dota2',
      external_id: 'dota2:Esports_World_Cup/2026/Group_Stage:matchlist:16:l1ga team vs nigma galaxy',
      team_a: 'L1GA TEAM',
      team_b: 'Nigma Galaxy',
      score_a: 0,
      score_b: 1,
      status: 'running',
      scheduled_at: scheduledAt - 600,
    },
  ];

  assert.deepEqual(
    dedupeMatches(rows).map((row) => row.external_id),
    [
      'dota2:Esports_World_Cup/2026/Group_Stage:matchlist:15:playtime vs team liquid',
      'dota2:Esports_World_Cup/2026/Group_Stage:matchlist:16:l1ga team vs nigma galaxy',
    ],
  );
});

test('dedupeMatches prefers scored PlayTime result over stale PTime live row', () => {
  const rows = [
    {
      id: 1,
      tournament_id: 10,
      game: 'dota2',
      external_id: 'dota2:1783427100:Team Liquid:PTime',
      team_a: 'Team Liquid',
      team_b: 'PTime',
      score_a: 0,
      score_b: 0,
      status: 'running',
      scheduled_at: 1_783_427_100,
    },
    {
      id: 2,
      tournament_id: 10,
      game: 'dota2',
      external_id: 'dota2:Esports_World_Cup/2026/Group_Stage:matchlist:15:playtime vs team liquid',
      team_a: 'Team Liquid',
      team_b: 'PlayTime',
      score_a: 1,
      score_b: 1,
      status: 'finished',
      scheduled_at: 1_783_427_700,
    },
  ];

  assert.deepEqual(dedupeMatches(rows), [rows[1]]);
});

test('markStaleActiveFinished retires old scheduled and running rows only', async (t) => {
  t.after(async () => {
    await closeDbClient();
  });

  const tournament = await run(
    `INSERT INTO tournaments (source, external_id, game, name, guild_id)
     VALUES ($1, $2, $3, $4, $5)`,
    ['liquipedia', 'overwatch/Test_Page', 'overwatch', 'Test Tournament', 'guild-1'],
  );
  const tournamentId = Number(tournament.lastInsertRowid);
  const now = Math.floor(Date.now() / 1000);
  const old = now - 5 * 3600;
  const future = now + 3600;

  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'old-scheduled',
    name: 'Old Scheduled',
    team_a: 'Team A',
    team_b: 'Team B',
    status: 'scheduled',
    scheduled_at: old,
  });
  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'old-running',
    name: 'Old Running',
    team_a: 'Team C',
    team_b: 'Team D',
    status: 'running',
    scheduled_at: old,
  });
  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'future-scheduled',
    name: 'Future Scheduled',
    team_a: 'Team E',
    team_b: 'Team F',
    status: 'scheduled',
    scheduled_at: future,
  });
  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'old-finished',
    name: 'Old Finished',
    team_a: 'Team G',
    team_b: 'Team H',
    status: 'finished',
    scheduled_at: old,
  });
  await upsertMatch({
    tournament_id: tournamentId,
    source: 'startgg',
    external_id: 'sgg:preview_3348077_2_1',
    name: 'Projected A vs Projected B',
    team_a: 'Projected A',
    team_b: 'Projected B',
    status: 'scheduled',
    scheduled_at: future,
  });
  await upsertMatch({
    tournament_id: tournamentId,
    source: 'startgg',
    external_id: 'sgg:104353062',
    name: 'Real A vs Real B',
    team_a: 'Real A',
    team_b: 'Real B',
    status: 'scheduled',
    scheduled_at: future,
  });
  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'apexlegends:br-schedule:missing',
    name: 'Missing Lobby Game',
    team_a: 'Group Stage - A vs B - Game 1',
    team_b: 'Lobby',
    status: 'scheduled',
    scheduled_at: future,
  });
  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'apexlegends:br-schedule:keep',
    name: 'Kept Lobby Game',
    team_a: 'Group Stage - A vs B - Game 2',
    team_b: 'Lobby',
    status: 'scheduled',
    scheduled_at: future,
  });

  const visibleMatches = await getMatchesForGuild('guild-1');
  assert.equal(
    visibleMatches.some((m) => m.external_id === 'sgg:preview_3348077_2_1'),
    false,
  );
  assert.equal(
    visibleMatches.some((m) => m.external_id === 'sgg:104353062'),
    true,
  );

  const activeMatches = await getActiveMatches();
  assert.equal(
    activeMatches.some((m) => m.external_id === 'sgg:preview_3348077_2_1'),
    false,
  );
  assert.equal(
    activeMatches.some((m) => m.external_id === 'sgg:104353062'),
    true,
  );

  const changed = await markStaleActiveFinished(4 * 3600);

  assert.equal(changed, 2);
  assert.equal((await getMatch('liquipedia', 'old-scheduled')).status, 'finished');
  assert.equal((await getMatch('liquipedia', 'old-running')).status, 'finished');
  assert.equal((await getMatch('liquipedia', 'future-scheduled')).status, 'scheduled');
  assert.equal((await getMatch('liquipedia', 'old-finished')).status, 'finished');

  const deletedPreviewRows = await deleteTournamentPlaceholderMatches(tournamentId, [
    'sgg:104353062',
    'apexlegends:br-schedule:keep',
  ]);
  assert.equal(deletedPreviewRows, 2);
  assert.equal(await getMatch('startgg', 'sgg:preview_3348077_2_1'), null);
  assert.equal((await getMatch('startgg', 'sgg:104353062')).status, 'scheduled');
  assert.equal(await getMatch('liquipedia', 'apexlegends:br-schedule:missing'), null);
  assert.equal((await getMatch('liquipedia', 'apexlegends:br-schedule:keep')).status, 'scheduled');
});
