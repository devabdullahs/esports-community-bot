import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tournament-duplicate-cleanup-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');

const { closeDb } = await import('../src/db/index.js');
const {
  addTournament,
  archiveDuplicateTournamentUrls,
  archiveSupersededTournamentSources,
  listActiveTournaments,
  resolveCanonicalTournamentId,
} = await import('../src/db/tournaments.js');
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

test('the event-scoped start.gg FC Pro Play-Ins supersedes only its Liquipedia mirror', async () => {
  const mirror = await addTournament({
    source: 'liquipedia',
    external_id: 'FC_Pro_26/Play-Ins',
    game: 'easportsfc',
    name: 'FC Pro 26 Play-Ins',
    url: 'https://liquipedia.net/easportsfc/FC_Pro_26/Play-Ins',
    guild_id: 'fc-playins-guild',
  });
  const canonical = await addTournament({
    source: 'startgg',
    external_id:
      'tournament/fc-pro-last-chance-qualifier-at-2026-esports-world-cup/event/fc-pro-last-chance-qualifier-at-2026-esports-world-cup',
    game: 'easportsfc',
    name: 'FC Pro Last Chance Qualifier',
    url: eventUrl,
    guild_id: 'fc-playins-guild',
  });
  const worldChampionship = await addTournament({
    source: 'liquipedia',
    external_id: 'FC_Pro_26/World_Championship',
    game: 'easportsfc',
    name: 'FC Pro 26 World Championship',
    url: 'https://liquipedia.net/easportsfc/FC_Pro_26/World_Championship',
    guild_id: 'fc-playins-guild',
  });

  assert.equal(await archiveSupersededTournamentSources(2_000_000_001), 1);
  assert.equal(await resolveCanonicalTournamentId(mirror.id), canonical.id);
  assert.equal(await resolveCanonicalTournamentId(canonical.id), canonical.id);
  assert.equal(await resolveCanonicalTournamentId(worldChampionship.id), worldChampionship.id);
  assert.deepEqual(
    (await listActiveTournaments('fc-playins-guild')).map((row) => row.id).sort((a, b) => a - b),
    [canonical.id, worldChampionship.id].sort((a, b) => a - b),
  );
});
