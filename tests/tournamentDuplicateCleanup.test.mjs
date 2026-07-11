import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tournament-duplicate-cleanup-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');

const { closeDb } = await import('../src/db/index.js');
const { addTournament, archiveDuplicateTournamentUrls, listActiveTournaments } = await import(
  '../src/db/tournaments.js'
);
const { upsertMatch } = await import('../src/db/matches.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const eventUrl =
  'https://www.start.gg/tournament/fc-pro-last-chance-qualifier-at-2026-esports-world-cup/event/fc-pro-last-chance-qualifier-at-2026-esports-world-cup';

async function add(externalId, url = eventUrl) {
  return addTournament({
    source: 'startgg',
    external_id: externalId,
    game: 'easportsfc',
    name: externalId,
    url,
    guild_id: 'guild',
  });
}

test('archives a stale URL alias and keeps the copy with current matches', async () => {
  const stale = await add('fc-pro-last-chance-qualifier-at-2026-esports-world-cup');
  const current = await add(
    'tournament/fc-pro-last-chance-qualifier-at-2026-esports-world-cup/event/fc-pro-last-chance-qualifier-at-2026-esports-world-cup',
    `${eventUrl}/?utm_source=test#bracket`,
  );
  await upsertMatch({
    tournament_id: stale.id,
    source: 'startgg',
    external_id: 'stale-result',
    team_a: 'Old A',
    team_b: 'Old B',
    status: 'finished',
  });
  await upsertMatch({
    tournament_id: current.id,
    source: 'startgg',
    external_id: 'current-live',
    team_a: 'Live A',
    team_b: 'Live B',
    status: 'running',
  });

  assert.equal(await archiveDuplicateTournamentUrls(2_000_000_000), 1);
  assert.deepEqual((await listActiveTournaments('guild')).map((row) => row.id), [current.id]);
});

test('does not merge different event URLs from the same tournament', async () => {
  const first = await add('event-one', `${eventUrl}-one`);
  const second = await add('event-two', `${eventUrl}-two`);
  assert.equal(await archiveDuplicateTournamentUrls(), 0);
  const ids = (await listActiveTournaments('guild')).map((row) => row.id);
  assert.ok(ids.includes(first.id));
  assert.ok(ids.includes(second.id));
});
