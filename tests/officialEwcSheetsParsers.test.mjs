import assert from 'node:assert/strict';
import test from 'node:test';

const {
  parseBattleRoyaleGames,
  parseIndividualResults,
  parseOfficialWorkbook,
  parseSchedule,
  parseStandings,
  parseTournamentEnrichment,
  scheduleTimestamp,
  workbookDescriptor,
} = await import('../src/services/officialEwcSheets/parsers.js');

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

test('tournament enrichment strips source URLs and sensitive columns before persistence', () => {
  const parsed = parseTournamentEnrichment({
    'Tournament Information': [
      ['Organizer', 'Esports Foundation'],
      ['Venue', 'Riyadh'],
      ['Workbook ID', 'private-id'],
      ['Official Link', 'https://docs.google.com/spreadsheets/d/private'],
    ],
    'Participant Information': [
      ['Participant', 'Region', 'Contact Email', 'Sheet Link'],
      ['Team Falcons', 'Gulf', 'private@example.test', 'https://drive.google.com/private'],
      ['T1', 'Asia-Pacific', 'owner@example.test', 'https://example.test/private'],
    ],
  });

  assert.deepEqual(parsed.facts, [
    { label: 'Organizer', value: 'Esports Foundation' },
    { label: 'Venue', value: 'Riyadh' },
  ]);
  assert.deepEqual(parsed.sections, [{
    title: 'Participants',
    columns: ['Participant', 'Region'],
    entries: [
      { Participant: 'Team Falcons', Region: 'Gulf' },
      { Participant: 'T1', Region: 'Asia-Pacific' },
    ],
  }]);
  assert.doesNotMatch(JSON.stringify(parsed), /private|@example|google\.com/i);
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
      'Tournament Information': [['Organizer', 'Esports Foundation']],
    },
  );

  assert.equal(parsed.descriptor.game, 'pubg');
  assert.equal(parsed.schedule.length, 1);
  assert.equal(parsed.standings.length, 1);
  assert.deepEqual(parsed.overview.facts, [{ label: 'Organizer', value: 'Esports Foundation' }]);
});
