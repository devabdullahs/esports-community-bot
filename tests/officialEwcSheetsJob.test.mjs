import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.LOG_LEVEL = 'error';

const {
  findOfficialMatch,
  normalizedOfficialPair,
  officialWorkbookToken,
  OFFICIAL_PARSER_VERSION,
  resolveOfficialTournament,
} = await import('../src/jobs/officialEwcSheets.js');

test('a parser version bump re-reads a workbook that has not been edited', () => {
  const modifiedTime = '2026-07-30T13:34:41.000Z';
  const stored = officialWorkbookToken(modifiedTime, OFFICIAL_PARSER_VERSION - 1);

  // Same sheet, new parser: the token must differ or the workbook is skipped before it is
  // ever read, leaving the improved parser dormant until an unrelated edit.
  assert.notEqual(officialWorkbookToken(modifiedTime), stored);
  // Same sheet, same parser: still skipped, so steady-state polling stays cheap.
  assert.equal(officialWorkbookToken(modifiedTime), officialWorkbookToken(modifiedTime));
  // A real edit still invalidates it.
  assert.notEqual(officialWorkbookToken('2026-08-01T11:15:00.000Z'), officialWorkbookToken(modifiedTime));
});

function tournament(overrides = {}) {
  return {
    id: 1,
    active: 1,
    archived_at: null,
    game: 'valorant',
    ewc: 1,
    name: 'VALORANT at Esports World Cup 2026',
    external_id: 'valorant/Esports_World_Cup/2026',
    url: 'https://liquipedia.net/valorant/Esports_World_Cup/2026',
    ...overrides,
  };
}

test('tournament resolution succeeds only for one unambiguous active EWC event', () => {
  const descriptor = { game: 'easportsfc', tournamentNeedle: 'world championship' };
  const target = tournament({
    id: 22,
    game: 'easportsfc',
    name: 'FC Pro 26 World Championship at Esports World Cup 2026',
  });
  const unrelated = tournament({
    id: 180,
    game: 'easportsfc',
    name: 'FC Pro Last Chance Qualifier at Esports World Cup 2026',
  });

  assert.equal(resolveOfficialTournament([target, unrelated], descriptor)?.id, 22);
  assert.equal(resolveOfficialTournament([target, { ...target, id: 23 }], descriptor), null);
  assert.equal(resolveOfficialTournament([{ ...target, archived_at: 1 }], descriptor), null);
});

test('tournament resolution selects the Rocket League main event over its LCQ', () => {
  const descriptor = { game: 'rocketleague', tournamentNeedle: 'featuring rocket league' };
  const target = tournament({
    id: 7,
    game: 'rocketleague',
    name: 'Esports World Cup 2026 featuring Rocket League',
  });
  const lcq = tournament({
    id: 179,
    game: 'rocketleague',
    name: 'Rocket League Last Chance Qualifier at Esports World Cup 2026',
  });

  assert.equal(resolveOfficialTournament([target, lcq], descriptor)?.id, 7);
});

test('pair matching is order-independent and requires a unique timed candidate', () => {
  const scheduledAt = 1_785_000_000;
  const matches = [
    { id: 1, team_a: 'Team Falcons', team_b: 'T1', scheduled_at: scheduledAt },
    { id: 2, team_a: 'T1', team_b: 'Team Falcons', scheduled_at: scheduledAt + 10_800 },
  ];

  assert.equal(normalizedOfficialPair('T1', 'Team Falcons'), normalizedOfficialPair('Team Falcons', 'T1'));
  assert.equal(
    findOfficialMatch(matches, { teamA: 'T1', teamB: 'Team Falcons', scheduledAt: scheduledAt + 120 })?.id,
    1,
  );
});

test('same-pair rematches fail closed when time is absent or multiple rows are within tolerance', () => {
  const matches = [
    { id: 1, team_a: 'Alpha', team_b: 'Bravo', scheduled_at: 1_785_000_000 },
    { id: 2, team_a: 'Bravo', team_b: 'Alpha', scheduled_at: 1_785_000_600 },
  ];

  assert.equal(findOfficialMatch(matches, { teamA: 'Alpha', teamB: 'Bravo', scheduledAt: null }), null);
  assert.equal(
    findOfficialMatch(matches, { teamA: 'Alpha', teamB: 'Bravo', scheduledAt: 1_785_000_300 }),
    null,
  );
});

test('different-day rematches remain distinct', () => {
  const matches = [
    { id: 1, team_a: 'Alpha', team_b: 'Bravo', scheduled_at: 1_785_000_000 },
    { id: 2, team_a: 'Alpha', team_b: 'Bravo', scheduled_at: 1_785_086_400 },
  ];

  assert.equal(
    findOfficialMatch(matches, { teamA: 'Bravo', teamB: 'Alpha', scheduledAt: 1_785_086_400 })?.id,
    2,
  );
});
