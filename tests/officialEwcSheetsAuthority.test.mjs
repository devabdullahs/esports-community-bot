import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'official-ewc-authority-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const {
  deleteResolvedDuplicateMatches,
  getMatch,
  getMatchesForGuild,
  upsertMatch,
} = await import('../src/db/matches.js');
const {
  listStandingsForTournament,
  replaceTournamentStandings,
} = await import('../src/db/tournamentStandings.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function createTournament(externalId) {
  return addTournament({
    source: 'liquipedia',
    external_id: externalId,
    game: 'valorant',
    name: 'VALORANT at Esports World Cup 2026',
    url: null,
    guild_id: 'official-authority-test',
    added_by: 'admin',
  });
}

function matchRow(tournamentId, externalId, overrides = {}) {
  return {
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: externalId,
    name: 'Alpha vs Bravo',
    team_a: 'Alpha',
    team_b: 'Bravo',
    score_a: null,
    score_b: null,
    status: 'scheduled',
    scheduled_at: 1_785_000_000,
    ...overrides,
  };
}

test('fresh official match fields resist fallback overwrite and expired fields release normally', async () => {
  const tournament = await createTournament('valorant/EWC/official-match-authority');
  const observedAt = 1_785_000_000;
  const row = matchRow(tournament.id, 'Match:official', {
    score_a: 2,
    score_b: 1,
    status: 'finished',
  });
  await upsertMatch(row, {
    authoritative: true,
    observedAt,
    authorityTtlSeconds: 300,
    authorityFields: ['score_a', 'score_b', 'status'],
  });

  await upsertMatch(matchRow(tournament.id, 'Match:official', {
    score_a: 0,
    score_b: 0,
    status: 'running',
  }), { observedAt: observedAt + 60 });
  const protectedRow = await getMatch('liquipedia', 'Match:official');
  assert.equal(protectedRow.score_a, 2);
  assert.equal(protectedRow.score_b, 1);
  assert.equal(protectedRow.status, 'finished');

  await upsertMatch(matchRow(tournament.id, 'Match:official', {
    score_a: 3,
    score_b: 0,
    status: 'finished',
  }), { observedAt: observedAt + 301 });
  const releasedRow = await getMatch('liquipedia', 'Match:official');
  assert.equal(releasedRow.score_a, 3);
  assert.equal(releasedRow.score_b, 0);
  const [publicRow] = (await getMatchesForGuild('official-authority-test'))
    .filter((match) => match.external_id === 'Match:official');
  assert.equal(publicRow.official_authoritative, 1);
});

test('fresh official match cannot be removed by duplicate cleanup', async () => {
  const tournament = await createTournament('valorant/EWC/official-cleanup-authority');
  const observedAt = Math.floor(Date.now() / 1000);
  await upsertMatch(matchRow(tournament.id, 'Match:protected', {
    status: 'finished',
  }), {
    authoritative: true,
    observedAt,
    authorityTtlSeconds: 300,
    authorityFields: ['team_a', 'team_b', 'scheduled_at'],
  });
  await upsertMatch(matchRow(tournament.id, 'Match:scored', {
    score_a: 2,
    score_b: 0,
    status: 'finished',
  }));

  await deleteResolvedDuplicateMatches();

  assert.ok(await getMatch('liquipedia', 'Match:protected'));
  assert.ok(await getMatch('liquipedia', 'Match:scored'));
});

test('fresh official standings resist fallback replacement and expire cleanly', async () => {
  const tournament = await createTournament('valorant/EWC/official-standings-authority');
  const observedAt = 1_785_000_000;
  const official = [{ title: 'Grand Final', entries: [
    { rank: 1, team: 'Alpha', points: '10' },
    { rank: 2, team: 'Bravo', points: '8' },
  ] }];
  const fallback = [{ title: 'Grand Final', entries: [
    { rank: 1, team: 'Wrong', points: '99' },
    { rank: 2, team: 'Also Wrong', points: '98' },
  ] }];

  await replaceTournamentStandings(tournament.id, official, {
    authoritative: true,
    observedAt,
    authorityTtlSeconds: 300,
  });
  assert.equal(
    await replaceTournamentStandings(tournament.id, fallback, { observedAt: observedAt + 60 }),
    0,
  );
  assert.deepEqual(
    (await listStandingsForTournament(tournament.id)).map((row) => row.team),
    ['Alpha', 'Bravo'],
  );

  assert.equal(
    await replaceTournamentStandings(tournament.id, fallback, { observedAt: observedAt + 301 }),
    2,
  );
  assert.deepEqual(
    (await listStandingsForTournament(tournament.id)).map((row) => row.team),
    ['Wrong', 'Also Wrong'],
  );
});
