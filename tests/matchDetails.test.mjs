import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'match-details-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { run } = await import('../src/db/client.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { getMatchDetails, getMatchDetailsFetchedAt, upsertMatchDetails } = await import('../src/db/matchDetails.js');

let sequence = 0;
async function match() {
  sequence += 1;
  const tournament = await addTournament({
    source: 'liquipedia',
    external_id: `valorant/details-${sequence}`,
    game: 'valorant',
    name: 'Details Cup',
    guild_id: `guild-${sequence}`,
  });
  return upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: `Match:details-${sequence}`,
    team_a: 'Alpha',
    team_b: 'Beta',
    status: 'finished',
  });
}

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('match details upsert round-trips and overwrites the payload and fetched stamp', async () => {
  const row = await match();
  await upsertMatchDetails({ matchId: row.id, sourcePage: 'Match:details', game: 'valorant', payload: { version: 1, maps: [] } });
  assert.deepEqual((await getMatchDetails(row.id)).payload, { version: 1, maps: [] });
  assert.ok(await getMatchDetailsFetchedAt(row.id));

  await run("UPDATE match_details SET fetched_at = '2000-01-01 00:00:00' WHERE match_id = $1", [row.id]);
  await upsertMatchDetails({ matchId: row.id, sourcePage: 'Match:details', game: 'valorant', payload: { version: 1, maps: [{ name: 'Haven' }] } });
  const overwritten = await getMatchDetails(row.id);
  assert.deepEqual(overwritten.payload, { version: 1, maps: [{ name: 'Haven' }] });
  assert.notEqual(overwritten.fetched_at, '2000-01-01 00:00:00');
});

test('malformed stored JSON is a safe null result', async () => {
  const row = await match();
  await upsertMatchDetails({ matchId: row.id, sourcePage: 'Match:bad-json', game: 'valorant', payload: { version: 1 } });
  await run("UPDATE match_details SET payload_json = '{' WHERE match_id = $1", [row.id]);
  assert.equal(await getMatchDetails(row.id), null);
});

test('match detail rows cascade away with their match', async () => {
  const row = await match();
  await upsertMatchDetails({ matchId: row.id, sourcePage: 'Match:cascade', game: 'valorant', payload: { version: 1 } });
  await run('DELETE FROM matches WHERE id = $1', [row.id]);
  assert.equal(await getMatchDetails(row.id), null);
});
