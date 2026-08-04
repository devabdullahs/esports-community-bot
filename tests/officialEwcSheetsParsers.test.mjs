import assert from 'node:assert/strict';
import test from 'node:test';

const {
  parseBattleRoyaleGames,
  parseIndividualResults,
  parseOfficialWorkbook,
  parseSchedule,
  parseSeriesVetoes,
  parseStandings,
  parseTeamMapDetails,
  isLcqLabel,
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
      lcq: false,
      game: 'easportsfc',
      tournamentNeedle: 'world championship',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Mobile Legends Women\'s Invitational | Tournament Overview'),
    {
      label: 'mobile legends women\'s invitational',
      lcq: false,
      game: 'mobilelegends',
      tournamentNeedle: 'women',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Call of Duty: Black Ops 7 (COD BO7) | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'call of duty: black ops 7 (cod bo7)',
      lcq: false,
      game: 'callofduty',
      tournamentNeedle: 'black ops',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Call of Duty: Warzone | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'call of duty: warzone',
      lcq: false,
      game: 'callofduty',
      tournamentNeedle: 'warzone',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Dota2 | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'dota2',
      lcq: false,
      game: 'dota2',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Overwatch | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'overwatch',
      lcq: false,
      game: 'overwatch',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Rainbow Six Siege | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'rainbow six siege',
      lcq: false,
      game: 'rainbowsix',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Mobile Legends: Bang Bang Women (MLBBW / MWI) | Tournament Overview'),
    {
      label: 'mobile legends: bang bang women (mlbbw / mwi)',
      lcq: false,
      game: 'mobilelegends',
      tournamentNeedle: 'women',
    },
  );
  assert.deepEqual(
    workbookDescriptor('[PUBLIC] Rocket League | Tournament Overview | Esports World Cup 2026'),
    {
      label: 'rocket league',
      lcq: false,
      game: 'rocketleague',
      tournamentNeedle: 'featuring rocket league',
    },
  );
  assert.equal(workbookDescriptor('Internal credentials'), null);
});

// A last-chance qualifier ships as its own workbook for the same game, so the descriptor
// has to say which side of the split it is on before a tournament can be picked.
test('workbook titles mark last-chance qualifiers apart from their main event', () => {
  const lcqOf = (title) => workbookDescriptor(`[PUBLIC] ${title} | Tournament Overview | Esports World Cup 2026`);

  assert.equal(lcqOf('TEKKEN 8 (T8)').lcq, false);
  assert.equal(lcqOf('LCQ for Rocket League').lcq, true);
  assert.equal(lcqOf('Chess - LCQ').lcq, true);
  assert.equal(lcqOf('LCQ for Call of Duty: Black Ops 7 (COD BO7)').lcq, true);
  // Both spellings appear in tournament names; the workbook titles only use one.
  assert.equal(isLcqLabel('FC Pro Last Chance Qualifier at 2026 Esports World Cup'), true);
  assert.equal(isLcqLabel('Esports World Cup 2026: TEKKEN 8 - LCQ'), true);
  assert.equal(isLcqLabel('Tekken 8 - Esports World Cup 2026'), false);
});

// Rows copied from the official Rainbow Six workbook's veto tabs. One row per series, one
// column per veto step, so the three formats differ only in width — Bo1 bans eight maps
// down to a decider, Bo3 bans four, picks two, then bans two more before its decider.
const R6_BO1_VETOS = [
  ['Event', 'Match', 'Confirmed', 'Team A', 'Team B', 'Team A Ban ', 'Team B Ban ', 'Team A Ban ', 'Team B Ban ', 'Team A Ban', 'Team B Ban ', 'Team A Ban ', 'Team B Ban', 'Final Map', 'Team', 'Side Pick', 'Team', 'OT Side Pick', 'Date'],
  [
    'EWC 2026', 'Stream A - Day 1, Match 1', 'Confirmed', 'CAG by VARREL', 'Fnatic',
    'Border', 'Club House', 'Kafe', 'Consulate', 'Chalet', 'Lair', 'Fortress', 'Nighthaven Labs',
    'Bank', 'CAG by VARREL Side Choice', 'Attacking ', 'Fnatic OT Side Choice', 'Attacking ', 46238.54469196759,
  ],
];

const R6_BO3_VETOS = [
  ['Event', 'Match', 'Confirmed', 'Team A', 'Team B', 'Team A Ban ', 'Team B Ban ', 'Team A Ban ', 'Team B Ban ', 'Team A Map Pick', 'Team B', 'Side Pick', 'Team A ', 'OT Side Pick', 'Team B Map Pick', 'Team A', 'Side Pick', 'Team B', 'OT Side Pick', 'Team A Ban ', 'Team B Ban ', 'Decider', 'Date'],
  [
    'EWC 2026', 'Stream A - Day 1, Match 3', 'Confirmed', 'Fnatic', 'MIBR.LOS',
    'Border', 'Bank', 'Consulate', 'Lair',
    'Fortress', 'MIBR.LOS Side Choice', 'Defending', 'Fnatic OT Side Choice', 'Attacking ',
    'Kafe', 'Fnatic Side Choice', 'Defending', 'MIBR.LOS OT Side Choice', 'Defending',
    'Nighthaven Labs', 'Chalet', 'Club House', 46238.65527185185,
  ],
];

test('veto parser reads the Rainbow Six map ban sequence down to its decider', () => {
  const [bo1] = parseSeriesVetoes(R6_BO1_VETOS);

  assert.equal(bo1.teamA, 'CAG by VARREL');
  assert.equal(bo1.teamB, 'Fnatic');
  assert.equal(bo1.confirmed, true);
  assert.equal(bo1.bans.length, 8);
  assert.deepEqual(bo1.bans.map((ban) => [ban.team, ban.map]), [
    ['CAG by VARREL', 'Border'],
    ['Fnatic', 'Club House'],
    ['CAG by VARREL', 'Kafe'],
    ['Fnatic', 'Consulate'],
    ['CAG by VARREL', 'Chalet'],
    ['Fnatic', 'Lair'],
    ['CAG by VARREL', 'Fortress'],
    ['Fnatic', 'Nighthaven Labs'],
  ]);
  // Eight bans out of a nine-map pool leave exactly one map, chosen by neither side.
  assert.deepEqual(bo1.maps, [{
    map: 'Bank',
    order: 1,
    step: 9,
    pickedBy: '',
    sidePick: 'Attacking',
    sidePickTeam: 'CAG by VARREL',
    otSidePick: 'Attacking',
    otSidePickTeam: 'Fnatic',
  }]);
});

test('veto parser keeps a best-of-three picking order apart from its ban order', () => {
  const [bo3] = parseSeriesVetoes(R6_BO3_VETOS);

  assert.deepEqual(bo3.maps.map((map) => [map.order, map.map, map.pickedBy]), [
    [1, 'Fortress', 'Fnatic'],
    [2, 'Kafe', 'MIBR.LOS'],
    [3, 'Club House', ''],
  ]);
  // Bo3 bans two more maps AFTER both picks, so ban order and veto order diverge.
  assert.deepEqual(bo3.bans.map((ban) => [ban.order, ban.step, ban.map]), [
    [1, 1, 'Border'],
    [2, 2, 'Bank'],
    [3, 3, 'Consulate'],
    [4, 4, 'Lair'],
    [5, 7, 'Nighthaven Labs'],
    [6, 8, 'Chalet'],
  ]);
  assert.deepEqual(bo3.maps.map((map) => map.step), [5, 6, 9]);
  // The decider carries no side choice; the sheet leaves those columns empty.
  assert.equal(bo3.maps[2].sidePick, '');
  assert.equal(bo3.maps[0].sidePickTeam, 'MIBR.LOS');
  assert.equal(bo3.maps[0].otSidePickTeam, 'Fnatic');
});

test('veto tabs flow into the shared map-detail shape', () => {
  const parsed = parseOfficialWorkbook(
    '[PUBLIC] Rainbow Six Siege | Tournament Overview | Esports World Cup 2026',
    { BO1_VETOS: R6_BO1_VETOS, BO3_VETOS: R6_BO3_VETOS },
  );

  assert.equal(parsed.seriesVetoes.length, 2);
  assert.equal(parsed.mapDetails.length, 4);
  const bo3Maps = parsed.mapDetails.filter((detail) => detail.teamA === 'Fnatic');
  assert.deepEqual(bo3Maps.map((detail) => detail.map), ['Fortress', 'Kafe', 'Club House']);
  // The veto is agreed before the series is played, so it never carries a result.
  assert.equal(bo3Maps.every((detail) => detail.scoreA === null && detail.scoreB === null), true);
  // Map bans belong to the series, so every map of it carries the same list.
  assert.equal(bo3Maps[0].mapBans.length, 6);
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
    ['', '', '', '', '', '', '', '- PUBLIC-\n- CEST-', '- PUBLIC-\n- AST -'],
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
      scheduledAt: Math.floor(Date.parse('2026-08-02T10:00:00.000Z') / 1000),
    },
    {
      teamA: 'Weibo Gaming',
      teamB: 'Twisted Minds',
      scheduledAt: Math.floor(Date.parse('2026-08-02T11:45:00.000Z') / 1000),
    },
    {
      teamA: 'Loser of UB 2.1',
      teamB: 'Loser of UB 2.2',
      scheduledAt: Math.floor(Date.parse('2026-08-02T13:45:00.000Z') / 1000),
    },
    {
      teamA: 'Winner of 2.1',
      teamB: 'Winner of 2.2',
      scheduledAt: Math.floor(Date.parse('2026-08-02T15:30:00.000Z') / 1000),
    },
  ]);
});

// Rows copied from the official Rainbow Six Siege workbook. A team name whose second
// word starts with "V" used to swallow the separator search: the pair split three ways,
// was rejected, and the row landed as one blob team against a "Lobby" placeholder —
// a ghost fixture beside the real match instead of matching it on the team pair.
test('schedule parser splits pairs when a team name contains a V-initial word', () => {
  const parsed = parseSchedule([
    ['', 'Tournament Day #', '', 'Date', 'Week', 'Stream', 'Best of X', 'Start Time', '', '', '', '', '', 'Round', 'Match', 'Comment'],
    ['', '', '', '', '', '', '', '- PUBLIC-\n- CEST-', '- PUBLIC-\n- AST -'],
    ['', 'Day 1', 46238, 46238, 'SS1', 'Stream A', 'Bo1', '14:00', '', '', '', '', '', 'PL - Group B - UB 1.1', 'CAG by VARREL vs Fnatic'],
    ['', '', 46238, '', 'SS2', 'Stream B', 'Bo1', '14:00', '', '', '', '', '', 'PL - Group B - UB 1.2', 'KINGZERO eSports vs MIBR.LOS'],
    ['', '', 46238, '', 'SS1', 'Stream A', 'Bo3', '16:00', '', '', '', '', '', 'PL - Group A - UB 2.1', 'Twisted Minds vs Team Vitality'],
  ], { game: 'rainbowsix' });

  assert.deepEqual(parsed.map((match) => [match.teamA, match.teamB]), [
    ['CAG by VARREL', 'Fnatic'],
    ['KINGZERO eSports', 'MIBR.LOS'],
    ['Twisted Minds', 'Team Vitality'],
  ]);
  assert.equal(parsed.some((match) => match.teamB === 'Lobby'), false);
});

test('schedule status treats a non-terminal best-of score as running', () => {
  const parsed = parseSchedule([
    ['Date', 'Start Time', 'Best of X', 'Round', 'Match', 'Score A', 'Score B'],
    ['2026/08/02', '12:00', 'Bo5', 'Semifinal', 'Alpha vs Bravo', 2, 2],
    ['2026/08/02', '13:00', 'Bo5', 'Semifinal', 'Charlie vs Delta', 3, 2],
  ], { game: 'overwatch' });

  assert.deepEqual(parsed.map((match) => match.status), ['running', 'finished']);
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
