import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.LOG_LEVEL = 'error';

const {
  deriveOfficialOverwatchSeriesResult,
  findOfficialMatch,
  liveRotationWorkbooks,
  normalizedOfficialPair,
  officialTeamLogo,
  officialScheduleAliases,
  officialWorkbookToken,
  OFFICIAL_PARSER_VERSION,
  prioritizeOfficialWorkbooks,
  resolveOfficialTournament,
  shouldApplyOfficialOverwatchSeriesResult,
  shouldFastPollOfficialWorkbook,
  shouldReadOfficialWorkbook,
} = await import('../src/jobs/officialEwcSheets.js');

test('official Overwatch maps publish the partial series score without summing map rounds', () => {
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
  assert.deepEqual(deriveOfficialOverwatchSeriesResult(maps.slice(0, 3), match), {
    scoreA: 2,
    scoreB: 1,
    status: 'running',
  });
  assert.deepEqual(
    deriveOfficialOverwatchSeriesResult(
      maps.slice(0, 3).map((map) => ({ ...map, round: 'Grand Final' })),
      match,
    ),
    { scoreA: 2, scoreB: 1, status: 'running' },
  );
});

test('official Overwatch corrections ignore unfinished maps and reopen a stale final', () => {
  const match = { team_a: 'Twisted Minds', team_b: 'Geekay Esports' };
  const maps = [
    { map: 'Nepal', mode: 'Control', scoreA: 2, scoreB: 0, winner: 'Twisted Minds' },
    { map: 'Neon Junction', mode: 'Hybrid', scoreA: 1, scoreB: 0, winner: 'Twisted Minds' },
    { map: 'New Junk City', mode: 'Flashpoint', scoreA: null, scoreB: null, winner: null },
  ].map((map) => ({
    ...map,
    teamA: 'Twisted Minds',
    teamB: 'Geekay Esports',
    round: 'Playoffs - Quarterfinal 1',
  }));

  assert.deepEqual(deriveOfficialOverwatchSeriesResult(maps, match), {
    scoreA: 2,
    scoreB: 0,
    status: 'running',
  });
});

test('official Overwatch series score follows map winners when round scores use the opposite orientation', () => {
  const match = { team_a: 'Twisted Minds', team_b: 'Weibo Gaming' };
  const maps = [
    ['Nepal', 2, 1, 'Weibo Gaming'],
    ['Route 66', 2, 1, 'Weibo Gaming'],
    ['Neon Junction', 1, 3, 'Twisted Minds'],
  ].map(([map, scoreA, scoreB, winner]) => ({
    teamA: 'Twisted Minds',
    teamB: 'Weibo Gaming',
    round: 'Playoffs - Semifinal 2',
    mode: map === 'Nepal' ? 'Control' : map === 'Route 66' ? 'Escort' : 'Hybrid',
    map,
    scoreA,
    scoreB,
    winner,
  }));

  assert.deepEqual(deriveOfficialOverwatchSeriesResult(maps, match), {
    scoreA: 1,
    scoreB: 2,
    status: 'running',
  });
});

test('an incomplete official map snapshot cannot reopen a terminal match', () => {
  assert.equal(
    shouldApplyOfficialOverwatchSeriesResult(
      { id: 19950405, status: 'finished', score_a: 3, score_b: 2 },
      { scoreA: 2, scoreB: 2, status: 'running' },
    ),
    false,
  );
  assert.equal(
    shouldApplyOfficialOverwatchSeriesResult(
      { id: 19979689, status: 'scheduled', score_a: null, score_b: null },
      { scoreA: 1, scoreB: 0, status: 'running' },
    ),
    true,
  );
  assert.equal(
    shouldApplyOfficialOverwatchSeriesResult(
      { id: 19950405, status: 'finished', score_a: 3, score_b: 2 },
      { scoreA: 2, scoreB: 3, status: 'finished' },
      { terminalMatchIds: new Set([19950405]) },
    ),
    false,
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

test('official logo reconciliation uses the canonical logo for each team, not row position', () => {
  const weiboLogo = 'https://liquipedia.net/commons/images/Weibo_allmode.png';
  const twistedLogo = 'https://liquipedia.net/commons/images/Twisted_Minds_2023_allmode.png';
  const existing = {
    id: 3,
    team_a: 'Weibo Gaming',
    logo_a: twistedLogo,
    team_b: 'Twisted Minds',
    logo_b: weiboLogo,
  };
  const peers = [
    { id: 1, team_a: 'Weibo Gaming', logo_a: weiboLogo, team_b: 'Team Liquid', logo_b: 'liquid' },
    { id: 2, team_a: 'Twisted Minds', logo_a: twistedLogo, team_b: 'Geekay Esports', logo_b: 'geekay' },
    existing,
  ];

  assert.equal(officialTeamLogo(peers, existing, 'Weibo Gaming'), weiboLogo);
  assert.equal(officialTeamLogo(peers, existing, 'Twisted Minds'), twistedLogo);
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

// Warzone and Black Ops 7 are separate EWC events whose tournaments are both stored under
// the `callofduty` game. Without a needle on each, the sole active Call of Duty tournament
// is a unique candidate for BOTH workbooks, so Black Ops 7 wrote its fixtures into the
// Warzone championship while the Warzone workbook resolved to nothing.
test('tournament resolution keeps the two Call of Duty workbooks apart', () => {
  const warzone = tournament({
    id: 41,
    game: 'callofduty',
    name: 'Warzone Resurgence Series 2026 Championship',
  });

  assert.equal(
    resolveOfficialTournament([warzone], { game: 'callofduty', tournamentNeedle: 'warzone' })?.id,
    41,
  );
  // No Black Ops 7 tournament is tracked yet: staying unresolved is the correct outcome.
  assert.equal(
    resolveOfficialTournament([warzone], { game: 'callofduty', tournamentNeedle: 'black ops' }),
    null,
  );

  const blackOps = tournament({
    id: 200,
    game: 'callofduty',
    name: 'Call of Duty: Black Ops 7 at Esports World Cup 2026',
  });
  assert.equal(
    resolveOfficialTournament([warzone, blackOps], { game: 'callofduty', tournamentNeedle: 'black ops' })?.id,
    200,
  );
  assert.equal(
    resolveOfficialTournament([warzone, blackOps], { game: 'callofduty', tournamentNeedle: 'warzone' })?.id,
    41,
  );
});

// TEKKEN 8 runs a last-chance qualifier as its own EWC tournament under the same
// `fighters` game. The main event's needle matches the LCQ name too, so both survived
// filtering, "exactly one candidate" failed, and the main bracket was never ingested.
test('tournament resolution keeps a last-chance qualifier out of its main event', () => {
  const main = tournament({
    id: 50,
    game: 'fighters',
    name: 'Tekken 8 - Esports World Cup 2026',
    external_id: 'fighters/Esports_World_Cup/2026/Tekken_8',
  });
  const lcq = tournament({
    id: 97,
    game: 'fighters',
    name: 'Esports World Cup 2026: TEKKEN 8 - LCQ',
    external_id: 'fighters/Esports_World_Cup/2026/Tekken_8/Last_Chance_Qualifier',
  });
  const descriptor = { game: 'fighters', tournamentNeedle: 'tekken', lcq: false };

  assert.equal(resolveOfficialTournament([main, lcq], descriptor)?.id, 50);
  assert.equal(resolveOfficialTournament([main, lcq], { ...descriptor, lcq: true })?.id, 97);
  // A sibling game in the same tournament family must still be excluded by its needle.
  const streetFighter = tournament({
    id: 49,
    game: 'fighters',
    name: 'Street Fighter 6 - Esports World Cup 2026',
    external_id: 'fighters/Esports_World_Cup/2026/Street_Fighter_6',
  });
  assert.equal(resolveOfficialTournament([main, lcq, streetFighter], descriptor)?.id, 50);
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

test('full official refresh prioritizes running and nearest upcoming tournaments', async () => {
  const workbooks = [
    { id: 'later', name: 'Overwatch 2' },
    { id: 'unsupported', name: 'Internal planning' },
    { id: 'running', name: 'CrossFire' },
    { id: 'soon', name: 'Call of Duty Black Ops 7' },
  ];
  const tournaments = [
    tournament({ id: 11, game: 'overwatch' }),
    tournament({ id: 12, game: 'crossfire' }),
    tournament({
      id: 13,
      game: 'callofduty',
      name: 'Call of Duty: Black Ops 7 at Esports World Cup 2026',
    }),
  ];
  const matches = new Map([
    [11, [{ status: 'scheduled', scheduled_at: 1_785_020_000 }]],
    [12, [{ status: 'running', scheduled_at: 1_785_000_000 }]],
    [13, [{ status: 'scheduled', scheduled_at: 1_785_010_000 }]],
  ]);

  const ordered = await prioritizeOfficialWorkbooks(workbooks, tournaments, {
    loadMatches: async (tournamentId) => matches.get(tournamentId) || [],
    nowSeconds: 1_785_000_000,
  });

  assert.deepEqual(ordered.map((workbook) => workbook.id), [
    'running',
    'soon',
    'later',
    'unsupported',
  ]);
});

test('a unique provider match accepts an official time outside the Liquipedia tolerance', () => {
  const liquipediaTime = 1_785_000_000;
  const matches = [
    {
      id: 1,
      external_id: 'Match:overwatch-semifinal-1',
      team_a: 'ZETA DIVISION',
      team_b: 'T1',
      scheduled_at: liquipediaTime,
    },
  ];

  assert.equal(
    findOfficialMatch(matches, {
      teamA: 'ZETA DIVISION',
      teamB: 'T1',
      scheduledAt: liquipediaTime + 3_600,
    })?.id,
    1,
  );
});

test('an official duplicate folds back onto the stable provider match identity', () => {
  const officialTime = 1_785_003_600;
  const matches = [
    {
      id: 1,
      external_id: 'Match:overwatch-semifinal-2',
      team_a: 'Weibo Gaming',
      team_b: 'Twisted Minds',
      scheduled_at: officialTime - 3_600,
    },
    {
      id: 2,
      external_id: 'official:existing-duplicate',
      team_a: 'Weibo Gaming',
      team_b: 'Twisted Minds',
      scheduled_at: officialTime,
    },
  ];

  assert.equal(
    findOfficialMatch(matches, {
      teamA: 'Weibo Gaming',
      teamB: 'Twisted Minds',
      scheduledAt: officialTime,
    })?.id,
    1,
  );
});

test('same-time provider aliases form one official schedule occurrence', () => {
  const liquipediaTime = 1_785_000_000;
  const matches = [
    {
      id: 1,
      external_id: 'overwatch:event:bracket:22:weibo gaming vs twisted minds',
      team_a: 'Weibo Gaming',
      team_b: 'Twisted Minds',
      scheduled_at: liquipediaTime,
    },
    {
      id: 2,
      external_id: 'overwatch:event/playoffs:bracket:22:weibo gaming vs twisted minds',
      team_a: 'Twisted Minds',
      team_b: 'Weibo Gaming',
      scheduled_at: liquipediaTime,
    },
    {
      id: 3,
      external_id: 'official:existing-duplicate',
      team_a: 'Weibo Gaming',
      team_b: 'Twisted Minds',
      scheduled_at: liquipediaTime - 3_600,
    },
  ];
  const update = {
    teamA: 'Weibo Gaming',
    teamB: 'Twisted Minds',
    scheduledAt: liquipediaTime - 3_600,
  };

  assert.deepEqual(officialScheduleAliases(matches, update).map((match) => match.id), [1, 2]);
  assert.equal(findOfficialMatch(matches, update)?.id, 1);
});

test('different-time provider rows remain ambiguous rematches', () => {
  const matches = [
    {
      id: 1,
      external_id: 'overwatch:event:bracket:22:alpha vs bravo',
      team_a: 'Alpha',
      team_b: 'Bravo',
      scheduled_at: 1_785_000_000,
    },
    {
      id: 2,
      external_id: 'overwatch:event:bracket:29:alpha vs bravo',
      team_a: 'Alpha',
      team_b: 'Bravo',
      scheduled_at: 1_785_010_800,
    },
  ];

  assert.deepEqual(
    officialScheduleAliases(matches, {
      teamA: 'Alpha',
      teamB: 'Bravo',
      scheduledAt: 1_785_020_000,
    }),
    [],
  );
});

test('the live rotation narrows to workbooks with a running match', () => {
  const workbooks = [
    { id: 'live-a', fastPollPriority: 0 },
    { id: 'soon-a', fastPollPriority: 1 },
    { id: 'soon-b', fastPollPriority: 1 },
    { id: 'live-b', fastPollPriority: 0 },
  ];

  // One workbook is read per tick, so rotating over all four quadruples the wait for the
  // event being played right now.
  assert.deepEqual(liveRotationWorkbooks(workbooks).map((entry) => entry.id), ['live-a', 'live-b']);
  // With nothing running, keep sweeping every candidate so upcoming events still land.
  const upcoming = workbooks.filter((entry) => entry.fastPollPriority === 1);
  assert.deepEqual(liveRotationWorkbooks(upcoming).map((entry) => entry.id), ['soon-a', 'soon-b']);
  assert.deepEqual(liveRotationWorkbooks([]), []);
});
