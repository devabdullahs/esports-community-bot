import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { run, closeDbClient } = await import('../src/db/client.js');
const { getMatch, upsertMatch, toMatchRow } = await import('../src/db/matches.js');

test('per-match official stream round-trips through toMatchRow + upsertMatch', async (t) => {
  t.after(async () => {
    await closeDbClient();
  });

  const tournament = await run(
    `INSERT INTO tournaments (source, external_id, game, name, guild_id)
     VALUES ($1, $2, $3, $4, $5)`,
    ['liquipedia', 'rocketleague/RLCS/2026', 'rocketleague', 'RLCS 2026', 'guild-1'],
  );
  const tournamentId = Number(tournament.lastInsertRowid);

  // toMatchRow lifts parsed.stream → stream_platform / stream_channel columns.
  const parsed = {
    source: 'liquipedia',
    externalId: 'Match:rl-live',
    name: 'marssyy vs tweex',
    teamA: 'marssyy',
    teamB: 'tweex',
    status: 'running',
    scheduledAt: Math.floor(Date.now() / 1000),
    stream: { platform: 'twitch', channel: 'RedirectEsports' },
  };
  const row = toMatchRow(parsed, tournamentId);
  assert.equal(row.stream_platform, 'twitch');
  assert.equal(row.stream_channel, 'RedirectEsports');

  await upsertMatch(row);
  const live = await getMatch('liquipedia', 'Match:rl-live');
  assert.equal(live.stream_platform, 'twitch');
  assert.equal(live.stream_channel, 'RedirectEsports');

  // When the match ends Liquipedia drops the stream link → the upsert clears it
  // (overwrite-on-conflict, not COALESCE), so finished cards don't show a stale link.
  await upsertMatch(toMatchRow({ ...parsed, status: 'finished', stream: null }, tournamentId));
  const ended = await getMatch('liquipedia', 'Match:rl-live');
  assert.equal(ended.stream_platform, null);
  assert.equal(ended.stream_channel, null);
});
