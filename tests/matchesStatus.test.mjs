import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { run, closeDbClient } = await import('../src/db/client.js');
const { deleteTournamentPlaceholderMatches, getMatch, markStaleActiveFinished, upsertMatch } = await import(
  '../src/db/matches.js'
);

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

  const changed = await markStaleActiveFinished(4 * 3600);

  assert.equal(changed, 2);
  assert.equal((await getMatch('liquipedia', 'old-scheduled')).status, 'finished');
  assert.equal((await getMatch('liquipedia', 'old-running')).status, 'finished');
  assert.equal((await getMatch('liquipedia', 'future-scheduled')).status, 'scheduled');
  assert.equal((await getMatch('liquipedia', 'old-finished')).status, 'finished');

  const deletedPreviewRows = await deleteTournamentPlaceholderMatches(tournamentId, ['sgg:104353062']);
  assert.equal(deletedPreviewRows, 1);
  assert.equal(await getMatch('startgg', 'sgg:preview_3348077_2_1'), null);
  assert.equal((await getMatch('startgg', 'sgg:104353062')).status, 'scheduled');
});
