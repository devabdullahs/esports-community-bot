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
const { upsertMatch, getMatch, deleteResolvedDuplicateMatches } = await import('../src/db/matches.js');

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
