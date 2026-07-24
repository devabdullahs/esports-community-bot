import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tournament-archive-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  addTournament,
  archiveTournament,
  getTournamentById,
  listActiveTournaments,
  listArchivedTournamentFacets,
  listArchivedTournaments,
  listEndedTournaments,
} = await import('../src/db/tournaments.js');
const { getActiveMatches, upsertMatch } = await import('../src/db/matches.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('finished stale tournaments are archived without deleting or deactivating them', async () => {
  const guildId = 'guild-archive';
  const old = Math.floor(Date.now() / 1000) - 5 * 24 * 3600;
  const tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'archive/example',
    game: 'valorant',
    name: 'Archive Example',
    url: 'https://liquipedia.net/valorant/Archive/Example',
    guild_id: guildId,
  });

  await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:archive-example',
    team_a: 'Alpha',
    team_b: 'Bravo',
    score_a: 2,
    score_b: 0,
    status: 'finished',
    scheduled_at: old,
  });

  const ended = await listEndedTournaments(72 * 3600);
  assert.ok(ended.some((row) => row.id === tournament.id));

  const archivedAt = Math.floor(Date.now() / 1000);
  const result = await archiveTournament(tournament.id, guildId, archivedAt);
  assert.equal(result.changes, 1);

  const stored = await getTournamentById(tournament.id);
  assert.equal(stored.active, 1);
  assert.equal(stored.archived_at, archivedAt);

  const active = await listActiveTournaments(guildId);
  assert.equal(active.some((row) => row.id === tournament.id), false);

  const watchable = await getActiveMatches();
  assert.equal(watchable.some((row) => row.tournament_id === tournament.id), false);

  const archived = await listArchivedTournaments(guildId, { limit: 5 });
  assert.equal(archived[0].id, tournament.id);
  assert.equal(archived[0].last_match_at, old);
});

test('re-adding an archived tournament clears archived_at and returns it to active reads', async () => {
  const guildId = 'guild-reactivate';
  const first = await addTournament({
    source: 'liquipedia',
    external_id: 'archive/reactivate',
    game: 'counterstrike',
    name: 'Archive Reactivate',
    url: 'https://liquipedia.net/counterstrike/Archive/Reactivate',
    guild_id: guildId,
  });
  await archiveTournament(first.id, guildId, Math.floor(Date.now() / 1000));

  const second = await addTournament({
    source: 'liquipedia',
    external_id: 'archive/reactivate',
    game: 'counterstrike',
    name: 'Archive Reactivate',
    url: 'https://liquipedia.net/counterstrike/Archive/Reactivate',
    guild_id: guildId,
  });

  assert.equal(second.id, first.id);
  assert.equal(second.active, 1);
  assert.equal(second.archived_at, null);

  const active = await listActiveTournaments(guildId);
  assert.equal(active.some((row) => row.id === first.id), true);
});

test('archive filters are applied before pagination and facets preserve lifecycle counts', async () => {
  const guildId = 'guild-filtered-archive';
  const now = Math.floor(Date.now() / 1000);
  const ewc = await addTournament({
    source: 'liquipedia',
    external_id: 'archive/ewc-filter',
    game: 'fighters',
    name: 'Fighter Games at Esports World Cup 2026',
    url: 'https://liquipedia.net/fighters/Esports_World_Cup/2026/Test',
    guild_id: guildId,
  });
  const regional = await addTournament({
    source: 'startgg',
    external_id: 'archive/regional-filter',
    game: 'fighters',
    name: 'Regional Open',
    url: 'https://start.gg/tournament/regional-open',
    guild_id: guildId,
  });
  await upsertMatch({
    tournament_id: ewc.id,
    source: 'liquipedia',
    external_id: 'Match:ewc-filter',
    team_a: 'Alpha',
    team_b: 'Bravo',
    score_a: 2,
    score_b: 1,
    status: 'finished',
    scheduled_at: now - 100,
  });
  await upsertMatch({
    tournament_id: regional.id,
    source: 'startgg',
    external_id: 'regional-filter-set',
    team_a: 'Charlie',
    team_b: 'Delta',
    score_a: 3,
    score_b: 0,
    status: 'finished',
    scheduled_at: now - 200,
  });
  await archiveTournament(ewc.id, guildId, now);
  await archiveTournament(regional.id, guildId, now);

  const filtered = await listArchivedTournaments(guildId, {
    limit: 1,
    ewcOnly: true,
    game: 'fighters',
    source: 'liquipedia',
    query: 'world cup',
    status: 'results',
  });
  assert.deepEqual(filtered.map((row) => row.id), [ewc.id]);

  const facets = await listArchivedTournamentFacets(guildId);
  const ewcFacet = facets.find((row) => row.id === ewc.id);
  assert.equal(Number(ewcFacet.finished_count), 1);
  assert.equal(Number(ewcFacet.running_count), 0);
  assert.equal(facets.length, 2);
});
