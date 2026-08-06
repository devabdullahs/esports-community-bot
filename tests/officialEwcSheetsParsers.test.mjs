import assert from 'node:assert/strict';
import test from 'node:test';

const {
  parseBattleRoyaleGames,
  parseIndividualResults,
  parseOfficialWorkbook,
  parseSchedule,
  parseBattleRoyaleStandings,
  parseBracketResults,
  parseBracketStructure,
  parseSeriesVetoes,
  parseTransposedSeriesVetoes,
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
      tournamentNeedle: ['black ops', 'bo7'],
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
    decider: true,
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
  // Nobody picks a decider, so an empty picker there is the answer, not a gap.
  assert.deepEqual(bo3.maps.map((map) => map.decider), [false, false, true]);
  // The decider carries no side choice; the sheet leaves those columns empty.
  assert.equal(bo3.maps[2].sidePick, '');
  assert.equal(bo3.maps[0].sidePickTeam, 'MIBR.LOS');
  assert.equal(bo3.maps[0].otSidePickTeam, 'Fnatic');
});

// Rows copied from the official Call of Duty workbook's FullMapvetos tab. Transposed
// relative to Rainbow Six: one COLUMN per series, one ROW per veto step, with mode
// headers between the steps and a second (empty) grid stacked underneath for longer
// series. Call of Duty bans within EACH mode rather than once for the whole series.
const COD_FULL_MAP_VETOS = [
  ['', 1, 2],
  ['', 'Groupstage - Group A - Opening Match #2', 'Groupstage - Group A - Opening Match #1'],
  ['', 'Movistar KOI vs. Carolina Royal Ravens', 'FaZe Clan vs. The Pit'],
  ['Higher seed', 'Movistar KOI', 'FaZe Clan'],
  ['Team A', 'Movistar KOI', 'FaZe Clan'],
  ['Team B', 'Carolina Royal Ravens', 'The Pit'],
  ['Hardpoint', '', ''],
  ['Team A bans', 'Scar', 'Hacienda'],
  ['Team B bans', 'Sake', 'Den'],
  ['Team A picks Game 1', 'Den', 'Scar'],
  ['Team B chooses sides for Game 1', 'Attackers', 'Attackers'],
  ['Team B picks Game 4', 'Hacienda', 'Sake'],
  ['Team A chooses sides for Game 4', 'Attackers', 'Defenders'],
  ['Team B picks Game 8', '', ''],
  ['Team A chooses sides for Game 8', '', ''],
  [],
  ['Search and Destroy', '', ''],
  ['Team B bans', 'Sake', 'Fringe'],
  ['Team A bans', 'Den', 'Sake'],
  ['Team B picks Game 2', 'Raid', 'Gridlock'],
  ['Team A chooses sides for Game 2', 'Attackers', 'Defenders'],
  ['Remaining map (Game 5)', 'Gridlock', 'Hacienda'],
  ['Team B chooses sides for Game 5', 'Defenders', 'Defenders'],
  [],
  ['Team A', '', ''],
  ['Team B', '', ''],
  ['Hardpoint', '', ''],
  ['Team A bans', '', ''],
];

test('veto parser reads the transposed Call of Duty grid, banning per mode', () => {
  const series = parseTransposedSeriesVetoes(COD_FULL_MAP_VETOS);

  // The stacked second grid names no teams, so it yields no series.
  assert.equal(series.length, 2);
  const [koi] = series;
  assert.equal(koi.teamA, 'Movistar KOI');
  assert.equal(koi.teamB, 'Carolina Royal Ravens');
  assert.equal(koi.round, 'Groupstage - Group A - Opening Match #2');

  // Maps are ordered by GAME number, not by the row they were vetoed on.
  assert.deepEqual(koi.maps.map((map) => [map.order, map.map, map.mode, map.pickedBy]), [
    [1, 'Den', 'Hardpoint', 'Movistar KOI'],
    [2, 'Raid', 'Search and Destroy', 'Carolina Royal Ravens'],
    [4, 'Hacienda', 'Hardpoint', 'Carolina Royal Ravens'],
    [5, 'Gridlock', 'Search and Destroy', ''],
  ]);
  // Game 5 is whatever the mode has left, so it carries no picker.
  assert.equal(koi.maps.at(-1).decider, true);
  assert.equal(koi.maps[0].decider, false);
  // The side choice belongs to the team that did NOT pick the map.
  assert.equal(koi.maps[0].sidePickTeam, 'Carolina Royal Ravens');
  assert.equal(koi.maps[0].sidePick, 'Attackers');

  // A ban only means something with its mode: Scar is banned in Hardpoint here while the
  // same map stays pickable in another mode.
  assert.deepEqual(koi.bans.map((ban) => [ban.mode, ban.team, ban.map]), [
    ['Hardpoint', 'Movistar KOI', 'Scar'],
    ['Hardpoint', 'Carolina Royal Ravens', 'Sake'],
    ['Search and Destroy', 'Carolina Royal Ravens', 'Sake'],
    ['Search and Destroy', 'Movistar KOI', 'Den'],
  ]);

  // Every column is read, not just the first.
  assert.equal(series[1].teamA, 'FaZe Clan');
  assert.equal(series[1].maps[0].map, 'Scar');
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

// Rows copied from the official Call of Duty workbook's Visualization tab. The bracket is
// drawn, not tabulated: a best-of as a bare number, then a match label, then its two teams
// with the series score in the NEXT column. Two brackets sit side by side.
const COD_VISUALIZATION = [
  ['GROUPSTAGE', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'PLAYOFFS'],
  ['Group A'],
  ['', '', '', 'UB Ro8 (Quarter-finals)', '', '', '', 'UB Ro4 (Semi-finals)'],
  ['', '', '', 5, '', '', '', 5],
  ['', '', '', 'UB 1.1'],
  ['', '', '', 'FaZe Clan', 3],
  ['', '', '', 'The Pit', 0, '', '', 'UB 2.1'],
  ['', '', '', '', '', '', '', 'FaZe Clan'],
  ['', '', '', 'UB 1.2', '', '', '', 'Movistar KOI'],
  ['', '', '', 'Movistar KOI', 3],
  ['', '', '', 'Carolina Royal Ravens', 0],
  [],
  ['', '', '', 'UB 1.3'],
  // Still being played: a Bo5 at 2-0 has not reached three wins.
  ['', '', '', 'G2 Esports', 2],
  ['', '', '', 'Cloud9', 0],
  [],
  ['', '', '', 'UB 1.4'],
  // Drawn but not played: the bracket writes 0-0 until it starts.
  ['', '', '', 'OpTic Gaming', 0],
  ['', '', '', 'Team WaR', 0],
  [],
  ['', '', '', 'LB 1.1 (loser out)'],
  // Not drawn yet: an undrawn slot must never be reported as a result.
  ['', '', '', 'Winner of UB 2.1', 1],
  ['', '', '', 'Loser of UB 2.2', 0],
];

test('bracket parser reads drawn series scores and leaves the undecided alone', () => {
  const results = parseBracketResults(COD_VISUALIZATION);

  assert.deepEqual(
    results.map((r) => [r.round, r.teamA, r.scoreA, r.scoreB, r.teamB, r.bestOf, r.status]),
    [
      ['UB 1.1', 'FaZe Clan', 3, 0, 'The Pit', 5, 'finished'],
      ['UB 1.2', 'Movistar KOI', 3, 0, 'Carolina Royal Ravens', 5, 'finished'],
      // A Bo5 at 2-0 is still running, so the provider keeps driving it.
      ['UB 1.3', 'G2 Esports', 2, 0, 'Cloud9', 5, 'running'],
    ],
  );
});

test('bracket parser keeps a match label from being read as a best-of', () => {
  const results = parseBracketResults(COD_VISUALIZATION);
  // "UB 1.1" parses loosely as the number 1.1; taking that as the best-of would make a
  // single map win look terminal.
  assert.equal(results.every((r) => r.bestOf === 5), true);

  // A best-of only comes from a genuine number in the sheet, so a bracket without one
  // still reports its scores and falls back to treating any score pair as final.
  const noBestOf = COD_VISUALIZATION.filter((row) => row[3] !== 5);
  const [first] = parseBracketResults(noBestOf);
  assert.equal(first.bestOf, null);
  assert.equal(first.status, 'finished');
});

test('bracket parser ignores the numeric tables sharing the tab', () => {
  // A ranking grid also reads as "a name beside a number", and one of these once parsed
  // as the series "1 0-721 2". A competitor's name always contains a letter.
  const results = parseBracketResults([
    ['', '', '', 'Group Stage'],
    ['', '', '', 14],
    ['', '', '', 1, 0],
    ['', '', '', 2, 721],
    [],
    ['', '', '', 'UB 1.1'],
    ['', '', '', 'FaZe Clan', 3],
    ['', '', '', 'The Pit', 0],
  ]);

  assert.deepEqual(results.map((r) => [r.teamA, r.teamB]), [['FaZe Clan', 'The Pit']]);
});

// Rows copied from the official PUBG Mobile workbook. A battle royale tabulates its stages
// SIDE BY SIDE and ranks by a points breakdown, with the rank as an unlabelled number
// beside the team and annotation rows between the stage name and the header.
const PUBGM_STANDINGS = [
  [],
  ['', 'Group Stage - Group A', '', '', '', '', '', '', '', 'Group Stage - Group B', '', '', '', '', '', '', '', 'Survival Stage'],
  [],
  ['', '', 'From game:', 1, '', 'Till game:', 12, '', '', '', 'From game:', 13, '', 'Till game:', 24, '', '', '', 'From game:', 25],
  ['', '', 'Team Name', 'WWCD', 'Place Points', 'Elimination Points', 'Total', 'Played matches', '', '', 'Team Name', 'WWCD', 'Place Points', 'Elimination Points', 'Total', 'Played matches', '', '', 'Team Name', 'WWCD', 'Place Points', 'Elimination Points', 'Total', 'Played matches'],
  ['', 1, 'FURIA', 2, 34, 18, 52, 12, '', 1, 'IDA Esports', 1, 30, 21, 51, 12, '', 1, '', 0, 0, 0, 0, 0],
  ['', 2, 'ULF Esports', 1, 28, 15, 43, 12, '', 2, 'YANGON GALACTICOS', 0, 26, 14, 40, 12, '', 2, '', 0, 0, 0, 0, 0],
];

test('battle-royale standings read each stage tabulated beside the others', () => {
  const sections = parseBattleRoyaleStandings(PUBGM_STANDINGS);

  // The Survival Stage has no teams drawn yet, so it yields nothing.
  assert.deepEqual(sections.map((s) => s.title), ['Group Stage - Group A', 'Group Stage - Group B']);
  assert.deepEqual(sections[0].entries.map((e) => [e.rank, e.team, e.points]), [
    [1, 'FURIA', '52'],
    [2, 'ULF Esports', '43'],
  ]);
  // The breakdown a single points column cannot carry.
  assert.equal(sections[0].entries[0].extra, 'WWCD 2 · 34 placement · 18 elims · 12 played');
  assert.equal(sections[1].entries[0].team, 'IDA Esports');
});

test('battle-royale standings take the stage name, not the annotation above the header', () => {
  // "From game:" sits between the stage name and the header row, in the same column.
  const sections = parseBattleRoyaleStandings(PUBGM_STANDINGS);
  assert.equal(sections.every((s) => !s.title.endsWith(':')), true);
});

// A battle royale has no fixture to name, so its Match column carries the MAP while the
// round says which game of which group it is. Taking the map made every PUBG game read
// "Rondo vs Lobby".
test('a lobby game is named by its round, not by the map it is played on', () => {
  const rows = [
    ['', 'Tournament Day #', '', 'Date', 'Week', 'Stream', 'Best of X', 'Start Time', '', '', '', '', '', 'Round', 'Match', 'Comment'],
    ['', '', '', '', '', '', '', '- PUBLIC-\n- CEST-'],
    ['', '', 46240, 46240, 'MS2', 'Stream A', 'Bo1', '13:00', '', '', '', '', '', 'Group Stage - Group A - Match 1', 'Rondo'],
  ];

  const lobby = parseSchedule(rows, { game: 'pubgmobile' });
  assert.equal(lobby[0].teamA, 'Group Stage - Group A - Match 1');
  assert.equal(lobby[0].teamB, 'Lobby');

  // A head-to-head game still prefers its Match column, which names the fixture.
  const headToHead = parseSchedule(rows, { game: 'rainbowsix' });
  assert.equal(headToHead[0].teamA, 'Rondo');
});

// The Visualization tab is the drawn bracket, so it carries the geometry a results list
// throws away: a name column is a round, slots run down it in order, and a later slot
// literally reads "Loser of UB 1.1" — so the edges are read rather than inferred.
const COD_BRACKET = [
  ['GROUPSTAGE', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'PLAYOFFS'],
  ['Group A'],
  ['', '', '', 'UB Ro8 (Quarter-finals)', '', '', '', 'UB Ro4 (Semi-finals)'],
  ['', '', '', 5, '', '', '', 5],
  ['', '', '', 'UB 1.1'],
  ['', '', '', 'FaZe Clan', 3],
  ['', '', '', 'The Pit', 0, '', '', 'UB 2.1'],
  ['', '', '', '', '', '', '', 'FaZe Clan'],
  ['', '', '', 'UB 1.2', '', '', '', 'Movistar KOI'],
  ['', '', '', 'Movistar KOI', 3],
  ['', '', '', 'Carolina Royal Ravens', 0],
  [],
  // A round whose slots are undrawn consumes no slot label. The heading must not leak on
  // to the block below it in the same column.
  ['', '', '', 'LB Ro4a'],
  ['', '', '', 'LB 1.1 (loser out)'],
  ['', '', '', 'Loser of UB 1.1', 0],
  ['', '', '', 'Loser of UB 1.2', 0],
  [],
  ['Group B'],
  ['', '', '', 'UB Ro8 (Quarter-finals)'],
  ['', '', '', 'UB 1.1'],
  ['', '', '', 'OpTic Gaming', 3],
  ['', '', '', 'Team WaR', 1],
];

test('bracket structure keeps the draw as a graph, not a list of results', () => {
  const groups = parseBracketStructure(COD_BRACKET);

  assert.deepEqual(
    groups.map((g) => [g.column, g.bracket, g.section, g.title, g.slots.length]),
    [
      [3, 'upper', 'Group A', 'UB Ro8 (Quarter-finals)', 2],
      [3, 'lower', 'Group A', 'LB Ro4a', 1],
      // Two groups draw the same round in the same column, so only the section tells them
      // apart — without it both read "UB Ro8 (Quarter-finals)".
      [3, 'upper', 'Group B', 'UB Ro8 (Quarter-finals)', 1],
    ],
  );
  // Group B's upper bracket must not be filed under Group A's lower-bracket heading.
  assert.equal(groups[2].slots[0].teamA, 'OpTic Gaming');
  assert.equal(groups[2].bracket, 'upper');

  // The edge is read off the sheet, not derived from bracket arithmetic.
  const undrawn = groups[1].slots[0];
  assert.deepEqual(undrawn.sourceA, { outcome: 'loser', slot: 'UB 1.1' });
  assert.deepEqual(undrawn.sourceB, { outcome: 'loser', slot: 'UB 1.2' });
  // 0-0 is how the bracket draws a slot nobody has played yet.
  assert.equal(undrawn.scoreA, null);
  assert.equal(undrawn.status, 'scheduled');

  const played = groups[0].slots[0];
  assert.equal(played.label, 'UB 1.1');
  assert.equal(played.status, 'finished');
  assert.equal(played.scoreA, 3);
});

test('schedule timestamps treat sheet dates as Riyadh local time', () => {
  assert.equal(
    scheduleTimestamp('2026/07/30', '6:30 PM'),
    Math.floor(Date.parse('2026-07-30T15:30:00.000Z') / 1000),
  );
});

// Rainbow Six retitled its time column to "Start Time\nROLLING SCHEDULE" mid-event. The
// header lookup matched aliases exactly, so findScheduleHeader stopped finding the header
// and the whole schedule silently parsed to zero fixtures.
test('schedule parser survives an annotation appended to a header', () => {
  const rows = [
    ['', 'Tournament Day #', '', 'Date', 'Week', 'Stream', 'Best of X', 'Start Time\nROLLING SCHEDULE', '', '', '', '', '', 'Round', 'Match', 'Comment'],
    ['', '', '', '', '', '', '', '- PUBLIC-\n- CEST-', '- PUBLIC-\n- AST -'],
    ['', 'Day 2', 46239, 46239, 'SS1', 'Stream A', 'Bo3', '18:15', '', '', '', '', '', 'PL - Semifinal 2', 'Fnatic vs. AlUla Club Esports'],
  ];

  const parsed = parseSchedule(rows, { game: 'rainbowsix' });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].teamA, 'Fnatic');
  assert.equal(parsed[0].teamB, 'AlUla Club Esports');
  // The header row marks the column CEST, so 18:15 there is 16:15 UTC (19:15 in Riyadh).
  assert.equal(parsed[0].scheduledAt, Math.floor(Date.parse('2026-08-05T16:15:00.000Z') / 1000));
});

test('a one-word header alias does not claim a longer neighbouring column', () => {
  // "time" must not latch onto "Time Zone" — only multi-word aliases match by prefix.
  const rows = [
    ['Date', 'Time Zone', 'Round', 'Match'],
    ['2026/08/05', 'CEST', 'Semifinal', 'Fnatic vs AlUla Club Esports'],
  ];
  assert.deepEqual(parseSchedule(rows, { game: 'rainbowsix' }), []);
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
