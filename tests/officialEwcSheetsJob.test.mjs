import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.LOG_LEVEL = 'error';

const {
  deriveOfficialOverwatchSeriesResult,
  findOfficialMatch,
  normalizedOfficialPair,
  officialWorkbookToken,
  OFFICIAL_PARSER_VERSION,
  resolveOfficialTournament,
  shouldFastPollOfficialWorkbook,
  shouldReadOfficialWorkbook,
} = await import('../src/jobs/officialEwcSheets.js');

test('completed official Overwatch maps promote the series result without finishing partial series', () => {
  const match = { team_a: 'Weibo Gaming', team_b: 'Spacestation Gaming' };
  const maps = [
    ['Nepal', 0, 2, 'Spacestation Gaming'],
    ['Neon Junction', 3, 2, 'Weibo Gaming'],
    ['Shambali Monastery', 2, 1, 'Weibo Gaming'],
    ['New Junk City', 3, 1, 'Weibo Gaming'],
  ].map(([map, scoreA, scoreB, winner]) => ({
    teamA: 'Weibo Gaming',
    teamB: 'Spacestation Gaming',
    round: 'Playoffs - Quarterfinal 2',
    map,
    mode: 'Control',
    scoreA,
    scoreB,
    winner,
  }));

  assert.deepEqual(deriveOfficialOverwatchSeriesResult(maps, match), {
    scoreA: 3,
    scoreB: 1,
    status: 'finished',
  });
  assert.equal(deriveOfficialOverwatchSeriesResult(maps.slice(0, 3), match), null);
  assert.equal(
    deriveOfficialOverwatchSeriesResult(
      maps.slice(0, 3).map((map) => ({ ...map, round: 'Grand Final' })),
      match,
    ),
    null,
  );
});

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

test('live polling reads formula changes even when Drive modifiedTime is unchanged', () => {
  const modifiedToken = officialWorkbookToken('2026-08-01T11:15:00.000Z');
  const previous = { modified_token: modifiedToken };

  assert.equal(shouldReadOfficialWorkbook(previous, modifiedToken), false);
  assert.equal(shouldReadOfficialWorkbook(previous, modifiedToken, { forceRead: true }), true);
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

test('fast official polling targets only running or near-start scheduled matches', () => {
  const nowSeconds = 1_785_000_000;
  const options = { nowSeconds, lookaheadSeconds: 10_800 };

  assert.equal(shouldFastPollOfficialWorkbook([{ status: 'running' }], options), true);
  assert.equal(
    shouldFastPollOfficialWorkbook(
      [{ status: 'scheduled', scheduled_at: nowSeconds + 7_200 }],
      options,
    ),
    true,
  );
  assert.equal(
    shouldFastPollOfficialWorkbook(
      [{ status: 'scheduled', scheduled_at: nowSeconds + 14_400 }],
      options,
    ),
    false,
  );
  assert.equal(
    shouldFastPollOfficialWorkbook(
      [{ status: 'finished', scheduled_at: nowSeconds - 60 }],
      options,
    ),
    true,
  );
  assert.equal(
    shouldFastPollOfficialWorkbook(
      [{ status: 'finished', scheduled_at: nowSeconds - 7 * 60 * 60 }],
      options,
    ),
    false,
  );
});
