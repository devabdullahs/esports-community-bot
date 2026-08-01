import assert from 'node:assert/strict';
import test from 'node:test';

const {
  parseBattleRoyaleGames,
  parseIndividualResults,
  parseOfficialWorkbook,
  parseSchedule,
  parseStandings,
  parseTeamMapDetails,
  parseTournamentEnrichment,
  scheduleTimestamp,
  workbookDescriptor,
} = await import('../src/services/officialEwcSheets/parsers.js');

// Column layout copied from the official Overwatch workbook's MATCH INFO MASTER tab:
// banner row, header row, then one row per map. Teams are written once per series and
// the ban-order columns repeat the team header labels.
const OVERWATCH_MATCH_LOG = [
  ['', 'TEAMS', '', 'Map & Mode', '', '', 'Hero Bans', '', 'Ban Order', '', 'Scores', '', '', 'ATK/DEF', ''],
  [
    'Series', '(A) Home', '(B) Away', 'Mode', 'MapName', 'PickedBy', 'Home Ban', 'Away Ban',
    '(A) Home', '(B) Away', 'Home Score', 'Away Score', 'Map Winner', 'Left (Blue/Def)', 'Right (Red/Atk)',
  ],
  [
    'Group B - Opening Match #4', 'ZETA DIVISION', 'VARREL', 'Control', 'Busan', 'ZETA DIVISION',
    'Bastion', 'Mauga', 1, 2, 2, 0, 'ZETA DIVISION', 'VARREL', 'ZETA DIVISION',
  ],
  [
    'Group B - Opening Match #4', '', '', 'Escort', 'Shambali Monastery', 'VARREL',
    'Kiriko', 'D.Va', 2, 1, 3, 0, 'ZETA DIVISION', 'VARREL', 'ZETA DIVISION',
  ],
  ['Group B - Opening Match #4', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  [
    'Playoffs - Quarterfinal 4', 'Crazy Raccoon', 'T1', 'Control', 'Nepal', 'Crazy Raccoon',
    'Mauga', 'Bastion', 1, 2, '', '', '', 'Crazy Raccoon', 'T1',
  ],
];

test('workbook titles resolve only to supported public tournament identities', () => {
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] EA SPORTS FC 26 | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'ea sports fc 26',
      game: 'easportsfc',
      tournamentNeedle: 'world championship',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Mobile Legends Women\'s Invitational | Tournament Overview'),
    {
      label: 'mobile legends women\'s invitational',
      game: 'mobilelegends',
      tournamentNeedle: 'women',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Call of Duty: Black Ops 7 (COD BO7) | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'call of duty: black ops 7 (cod bo7)',
      game: 'callofduty',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Dota2 | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'dota2',
      game: 'dota2',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Overwatch | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'overwatch',
      game: 'overwatch',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Rainbow Six Siege | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'rainbow six siege',
      game: 'rainbowsix',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Mobile Legends: Bang Bang Women (MLBBW / MWI) | Tournament Overview'),
    {
      label: 'mobile legends: bang bang women (mlbbw / mwi)',
      game: 'mobilelegends',
      tournamentNeedle: 'women',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Rocket League | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'rocket league',
      game: 'rocketleague',
      tournamentNeedle: 'featuring rocket league',
    },
  );
  assert.equal(workbookDescriptor('Internal credentials'), null);
});

test('schedule timestamps treat sheet dates as Riyadh local time', () => {
  assert.equal(
    scheduleTimestamp('2026/07/30', '6:30 PM'),
    Math.floor(Date.parse('2026-07-30T15:30:00.000Z') / 1000),
  );
});

test('schedule parser rejects formulas and preserves same-pair rematches as separate timed rows', () => {
  const rows = [
    ['Date', 'Start Time', 'Round', 'Match', 'Score A', 'Score B', 'Status'],
    ['2026/07/30', '6:00 PM', 'Group A - Round 1', 'Falcons vs T1', '', '', 'Scheduled'],
    ['2026/07/30', '9:00 PM', 'Group A - Round 2', 'Falcons vs T1', 2, 1, 'Finished'],
    ['=IMPORTDATA("https://example.test/private")', '10:00 PM', 'Bad', '=SECRET()', 1, 0, 'Finished'],
  ];

  const parsed = parseSchedule(rows, { game: 'valorant' });

  assert.equal(parsed.length, 2);
  assert.notEqual(parsed[0].externalId, parsed[1].externalId);
  assert.equal(parsed[0].scheduledAt, Math.floor(Date.parse('2026-07-30T15:00:00.000Z') / 1000));
  assert.equal(parsed[1].scheduledAt, Math.floor(Date.parse('2026-07-30T18:00:00.000Z') / 1000));
  assert.equal(parsed[1].status, 'finished');
});

test('schedule parser accepts the official Overwatch layout and carries merged day dates', () => {
  const parsed = parseSchedule([
    ['', 'Tournament Day #', '', 'Date', 'Week', 'Stream', 'Best of X', 'Start Time', '', '', '', '', '', 'Round', 'Match\n\nCamera left          vs          Camera right', 'Comment'],
    ['', 5, 46236, 46236, 'MS1', 'Stream A', 'Bo5', '12:00', '', '', '', '', '', 'Playoffs - Semifinal 1', 'ZETA DIVISION vs. T1'],
    ['', '', 46236, '', 'MS1', 'Stream A', 'Bo5', '13:45', '', '', '', '', '', 'Playoffs - Semifinal 2', 'Weibo Gaming vs.Twisted Minds'],
    ['', '', 46236, '', 'MS1', 'Stream A', 'Bo5', '15:45', '', '', '', '', '', 'Playoffs - 3rd place', 'Loser of UB 2.1 vs. Loser of UB 2.2'],
    ['', '', 46236, '', 'MS1', 'Stream A', 'Bo7', '17:30', '', '', '', '', '', 'Playoffs - Final', 'Winner of 2.1 vs. Winner of 2.2'],
  ], { game: 'overwatch' });

  assert.deepEqual(parsed.map((match) => ({
    teamA: match.teamA,
    teamB: match.teamB,
    scheduledAt: match.scheduledAt,
  })), [
    {
      teamA: 'ZETA DIVISION',
      teamB: 'T1',
      scheduledAt: Math.floor(Date.parse('2026-08-02T09:00:00.000Z') / 1000),
    },
    {
      teamA: 'Weibo Gaming',
      teamB: 'Twisted Minds',
      scheduledAt: Math.floor(Date.parse('2026-08-02T10:45:00.000Z') / 1000),
    },
    {
      teamA: 'Loser of UB 2.1',
      teamB: 'Loser of UB 2.2',
      scheduledAt: Math.floor(Date.parse('2026-08-02T12:45:00.000Z') / 1000),
    },
    {
      teamA: 'Winner of 2.1',
      teamB: 'Winner of 2.2',
      scheduledAt: Math.floor(Date.parse('2026-08-02T14:30:00.000Z') / 1000),
    },
  ]);
});

test('individual results parse player scores without carrying workbook metadata', () => {
  const parsed = parseIndividualResults(
    [
      ['Round and Match', 'Home Player', 'Away Player', 'Home Goals', 'Away Goals', 'PK Score Home', 'PK Score Away'],
      ['Round 1', 'Alpha', 'Bravo', 5, 4, '', ''],
    ],
    { game: 'easportsfc' },
  );

  assert.deepEqual(parsed, [{
    game: 'easportsfc',
    round: 'Round 1',
    teamA: 'Alpha',
    teamB: 'Bravo',
    scoreA: 5,
    scoreB: 4,
    penaltyA: null,
    penaltyB: null,
  }]);
});

test('standings parser removes repeated team rows and repeated tables', () => {
  const table = [
    ['Grand Final'],
    ['Rank', 'Team', 'Points'],
    [1, 'Team Falcons', 40],
    [1, 'Team Falcons', 40],
    [2, 'T1', 31],
  ];
  const parsed = parseStandings([...table, [], ...table]);

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].entries.map((entry) => entry.team), ['Team Falcons', 'T1']);
});

test('tournament enrichment persists only explicitly public aggregate facts', () => {
  const parsed = parseTournamentEnrichment({
    'Tournament Information': [
      ['Tournament Format', 'Double elimination'],
      ['Prize Pool', '$2,000,000'],
      ['Total Number of Teams', '24'],
      ['Players Arrival Date', '2026/07/20'],
      ['Camera Setup', 'Camera 4'],
      ['Admin Notes', 'Internal only'],
      ['Player Name', 'Private Person'],
      ['Workbook ID', 'private-id'],
      ['Official Link', 'https://docs.google.com/spreadsheets/d/private'],
    ],
    'Qualification Details': [
      ['Slot', 'Player Name', 'Arrival Date'],
      ['1', 'Private Person', '2026/07/20'],
    ],
    'Participant Information': [
      ['Participant', 'Region', 'Contact Email', 'Sheet Link'],
      ['Team Falcons', 'Gulf', 'private@example.test', 'https://drive.google.com/private'],
      ['T1', 'Asia-Pacific', 'owner@example.test', 'https://example.test/private'],
    ],
  });

  assert.deepEqual(parsed.facts, [
    { label: 'Tournament Format', value: 'Double elimination' },
    { label: 'Prize Pool', value: '$2,000,000' },
    { label: 'Total Number of Teams', value: '24' },
  ]);
  assert.deepEqual(parsed.sections, []);
  assert.doesNotMatch(
    JSON.stringify(parsed),
    /arrival|camera|admin|private person|participant|qualification|@example|google\.com/i,
  );
});

test('team map parser reads the official Overwatch match log with its per-map hero bans', () => {
  const parsed = parseTeamMapDetails(OVERWATCH_MATCH_LOG);

  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0], {
    teamA: 'ZETA DIVISION',
    teamB: 'VARREL',
    round: 'Group B - Opening Match #4',
    map: 'Busan',
    mode: 'Control',
    pickedBy: 'ZETA DIVISION',
    scoreA: 2,
    scoreB: 0,
    winner: 'ZETA DIVISION',
    banA: 'Bastion',
    banB: 'Mauga',
    banOrderA: 1,
    banOrderB: 2,
  });
});

test('team map parser carries a series team pair across its later map rows', () => {
  const parsed = parseTeamMapDetails(OVERWATCH_MATCH_LOG);

  // The sheet leaves the team cells blank on every map after the first.
  assert.deepEqual(
    { teamA: parsed[1].teamA, teamB: parsed[1].teamB, map: parsed[1].map },
    { teamA: 'ZETA DIVISION', teamB: 'VARREL', map: 'Shambali Monastery' },
  );
  // A new series must not inherit the previous one's teams.
  assert.equal(parsed[2].teamA, 'Crazy Raccoon');
  assert.equal(parsed[2].round, 'Playoffs - Quarterfinal 4');
});

test('team map parser keeps a played map that has no result yet', () => {
  const parsed = parseTeamMapDetails(OVERWATCH_MATCH_LOG);
  const live = parsed[2];

  assert.equal(live.scoreA, null);
  assert.equal(live.scoreB, null);
  assert.equal(live.winner, '');
  assert.equal(live.banA, 'Mauga', 'bans are known before the map is scored');
});

test('team map parser still reads a plain one-row-per-map sheet', () => {
  const parsed = parseTeamMapDetails([
    ['Round', 'Team A', 'Team B', 'Map', 'Score A', 'Score B', 'Winner'],
    ['Upper Final', 'Alpha', 'Bravo', 'Ascent', 13, 9, 'Alpha'],
  ]);

  assert.deepEqual(parsed, [{
    teamA: 'Alpha',
    teamB: 'Bravo',
    round: 'Upper Final',
    map: 'Ascent',
    mode: '',
    pickedBy: '',
    scoreA: 13,
    scoreB: 9,
    winner: 'Alpha',
    banA: '',
    banB: '',
    banOrderA: null,
    banOrderB: null,
  }]);
});

test('battle royale parser keeps per-game placement, elimination, and total points', () => {
  const parsed = parseBattleRoyaleGames([
    ['Game', 'Rank', 'Team', 'Placement Points', 'Elimination Points', 'Total Points'],
    ['Game 1', 1, 'Alpha', 10, 6, 16],
    ['Game 1', 2, 'Bravo', 6, 4, 10],
    ['Game 2', 1, 'Bravo', 10, 7, 17],
    ['Game 2', 2, 'Alpha', 6, 3, 9],
  ]);

  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    label: 'Game 1',
    standings: [
      { rank: 1, team: 'Alpha', placementPoints: 10, eliminationPoints: 6, totalPoints: 16 },
      { rank: 2, team: 'Bravo', placementPoints: 6, eliminationPoints: 4, totalPoints: 10 },
    ],
  });
});

test('full workbook parser combines public schedule, standings, overview, and details', () => {
  const parsed = parseOfficialWorkbook(
    '[PUBLIC] PUBG | Tournament Overview | Esports World Cup 2026',
    {
      Schedule: [
        ['Date', 'Start Time', 'Round', 'Match'],
        ['2026/07/31', '8:00 PM', 'Grand Final - Game 1', 'Grand Final - Game 1'],
      ],
      Visualization: [
        ['Grand Final'],
        ['Rank', 'Team', 'Points'],
        [1, 'Alpha', 20],
        [2, 'Bravo', 16],
      ],
      'Tournament Information': [['Tournament Format', 'Battle royale']],
    },
  );

  assert.equal(parsed.descriptor.game, 'pubg');
  assert.equal(parsed.schedule.length, 1);
  assert.equal(parsed.standings.length, 1);
  assert.deepEqual(parsed.overview.facts, [{ label: 'Tournament Format', value: 'Battle royale' }]);
});
