// Characterization tests for deleteResolvedDuplicateMatches: reschedule churn can
// leave a finished, score-less "phantom" row shadowing the real scored result for
// the same pair in the same tournament. The cleanup retires the phantom and ONLY
// the phantom — a genuinely-unresolved match (no scored twin) is always kept.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'match-phantom-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch, getMatch, deleteResolvedDuplicateMatches, deleteTournamentDuplicateMatches } = await import(
  '../src/db/matches.js'
);

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function tournament(externalId) {
  return addTournament({
    source: 'liquipedia',
    external_id: externalId,
    game: 'counterstrike',
    name: externalId,
    url: null,
    guild_id: 'g-cleanup',
    added_by: 'admin',
  });
}

function match(tournamentId, externalId, teamA, teamB, scoreA, scoreB, scheduledAt) {
  return upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: externalId,
    team_a: teamA,
    team_b: teamB,
    score_a: scoreA,
    score_b: scoreB,
    status: 'finished',
    scheduled_at: scheduledAt,
  });
}

test('retires a finished null-score phantom when a scored twin exists for the same pair', async () => {
  const t = await tournament('counterstrike/IEM/2026');
  await match(t.id, 'Match:1', 'Natus Vincere', 'Team Falcons', 2, 1, 1781457000); // real result
  await match(t.id, 'counterstrike:1781456400:Natus Vincere:Team Falcons', 'Natus Vincere', 'Team Falcons', null, null, 1781456400); // phantom

  const retired = await deleteResolvedDuplicateMatches();

  assert.equal(retired, 1, 'one phantom retired');
  assert.equal(
    await getMatch('liquipedia', 'counterstrike:1781456400:Natus Vincere:Team Falcons'),
    null,
    'phantom deleted',
  );
  assert.ok(await getMatch('liquipedia', 'Match:1'), 'the scored result is kept');
});

test('keeps a genuinely-unresolved finished match (no scored twin)', async () => {
  const t = await tournament('counterstrike/BLAST/2026');
  await match(t.id, 'counterstrike:BLAST:lone', 'Team A', 'Team B', null, null, 1781456400);

  const retired = await deleteResolvedDuplicateMatches();

  assert.equal(retired, 0, 'nothing retired when there is no scored twin');
  assert.ok(await getMatch('liquipedia', 'counterstrike:BLAST:lone'), 'unresolved match kept');
});

test('matches the pair regardless of team order', async () => {
  const t = await tournament('counterstrike/ESL/2026');
  await match(t.id, 'Match:9', 'G2 Esports', 'FaZe Clan', 2, 0, 1781000000); // scored
  await match(t.id, 'counterstrike:1780999000:FaZe Clan:G2 Esports', 'FaZe Clan', 'G2 Esports', null, null, 1780999000); // reversed-order phantom

  const retired = await deleteResolvedDuplicateMatches();

  assert.equal(retired, 1, 'reversed-order phantom is matched and retired');
  assert.equal(await getMatch('liquipedia', 'counterstrike:1780999000:FaZe Clan:G2 Esports'), null);
  assert.ok(await getMatch('liquipedia', 'Match:9'));
});

// deleteTournamentDuplicateMatches: a page can render the SAME match in both a
// bracket and a match-list widget (TFT-at-EWC does), so it lands under two ids that
// collapse to one on read. Once a fetch settles on one canonical id per pair+day,
// the sibling row is a stale duplicate — but only when a current row covers that
// pair+day, so a real match that merely vanished from one parse is never dropped.
function sched(tournamentId, externalId, teamA, teamB, scheduledAt) {
  return upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: externalId,
    team_a: teamA,
    team_b: teamB,
    score_a: null,
    score_b: null,
    status: 'scheduled',
    scheduled_at: scheduledAt,
  });
}

test('removes a bracket+matchlist twin, keeping the row in the current fetch', async () => {
  const t = await tournament('tft/EWC/2026');
  await sched(t.id, 'tft:EWC/2026:bracket:0', 'Weibo Gaming', 'T1', 1784620800);
  await sched(t.id, 'tft:EWC/2026:matchlist:0', 'Weibo Gaming', 'T1', 1784620800);

  const removed = await deleteTournamentDuplicateMatches(t.id, ['tft:EWC/2026:bracket:0']);

  assert.equal(removed, 1);
  assert.equal(await getMatch('liquipedia', 'tft:EWC/2026:matchlist:0'), null, 'stale twin deleted');
  assert.ok(await getMatch('liquipedia', 'tft:EWC/2026:bracket:0'), 'canonical row kept');
});

test('keeps a same-pair rematch on a different day', async () => {
  const t = await tournament('tft/EWC/2026-b');
  const day2 = 1784620800 + 86400;
  await sched(t.id, 'tft:b:bracket:0', 'MOUZ', 'All Gamers', 1784620800); // day 1 canonical
  await sched(t.id, 'tft:b:matchlist:0', 'MOUZ', 'All Gamers', 1784620800); // day 1 twin
  await sched(t.id, 'tft:b:bracket:9', 'MOUZ', 'All Gamers', day2); // day 2 rematch canonical

  const removed = await deleteTournamentDuplicateMatches(t.id, ['tft:b:bracket:0', 'tft:b:bracket:9']);

  assert.equal(removed, 1, 'only the day-1 twin is removed');
  assert.equal(await getMatch('liquipedia', 'tft:b:matchlist:0'), null);
  assert.ok(await getMatch('liquipedia', 'tft:b:bracket:9'), 'the different-day rematch is kept');
});

test('never deletes a match whose pair+day has no current row (transient parse gap)', async () => {
  const t = await tournament('tft/EWC/2026-c');
  await sched(t.id, 'tft:c:bracket:0', 'Fnatic', 'Team GoDlike', 1784620800);

  // The current fetch returned only an unrelated match — the Fnatic pair vanished this cycle.
  const removed = await deleteTournamentDuplicateMatches(t.id, ['tft:c:bracket:7']);

  assert.equal(removed, 0);
  assert.ok(await getMatch('liquipedia', 'tft:c:bracket:0'), 'vanished real match preserved');
});

test('no-op when the current id list is empty or null', async () => {
  const t = await tournament('tft/EWC/2026-d');
  await sched(t.id, 'tft:d:matchlist:0', 'Gen.G', 'DRX', 1784620800);

  assert.equal(await deleteTournamentDuplicateMatches(t.id, []), 0);
  assert.equal(await deleteTournamentDuplicateMatches(t.id, null), 0);
  assert.ok(await getMatch('liquipedia', 'tft:d:matchlist:0'), 'nothing deleted');
});
