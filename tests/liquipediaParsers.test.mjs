// Fixture-based characterization tests for the Liquipedia HTML parsers.
// These tests exercise the selector logic without any network calls.
// They use synthetic HTML derived from the selectors each parser reads.
//
// Run: npm test
//   or: node --test tests/liquipediaParsers.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';

// Set required env vars before any imports that trigger config.js.
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

import { load } from 'cheerio';

const {
  parseClubStandings,
  parseEwcEventSchedule,
  parseEwcClubs,
  parseSwissMatches,
  parseMatchlistMatch,
  parseBracketMatch,
  parseMatchInfo,
} = await import('../src/services/liquipedia.js');

// ---------------------------------------------------------------------------
// parseClubStandings
// ---------------------------------------------------------------------------

test('parseClubStandings: returns ranked rows from a standings table', () => {
  // Needs >5 rows total (header + 4 data) to pass the length guard.
  // The header must include "Team" and "Points" to pass the column detection.
  // teamName() prefers data-highlightingclass; falls back to a[title].last().
  // Use plain team name in a[title] — no "game:" prefix (teamName() doesn't strip it).
  const html = `
    <table class="wikitable">
      <tr><th>#</th><th>Team</th><th>Points</th></tr>
      <tr><td>1</td><td><span data-highlightingclass="Team Falcons">  Team Falcons  </span></td><td>300</td></tr>
      <tr><td>2</td><td><a title="Gen.G">Gen.G</a></td><td>250</td></tr>
      <tr><td>3</td>
          <td><span class="nested"><b><a title="Natus Vincere">Natus Vincere</a></b></span></td>
          <td>  200  </td>
      </tr>
      <tr><td>4</td><td><a title="Team Vitality">Team Vitality</a></td><td>150</td></tr>
      <tr><td>5</td><td><a title="T1">T1</a></td><td>100</td></tr>
    </table>
  `;
  const $ = load(html);
  const rows = parseClubStandings($);

  assert.equal(rows.length, 5, 'should return 5 rows');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].team, 'Team Falcons');
  assert.equal(rows[0].points, 300);
  assert.equal(rows[1].rank, 2);
  assert.equal(rows[1].team, 'Gen.G');
  assert.equal(rows[1].points, 250);
  // Row 3: whitespace + nested markup in the name cell
  assert.equal(rows[2].rank, 3);
  assert.equal(rows[2].team, 'Natus Vincere');
  assert.equal(rows[2].points, 200);
});

test('parseClubStandings: uses latest week snapshot when data-toggle-area-content is present', () => {
  // Rows tagged with data-toggle-area-content; parser picks the highest N = latest week.
  const html = `
    <table class="wikitable">
      <tr><th>#</th><th>Team</th><th>Points</th></tr>
      <tr data-toggle-area-content="1"><td>1</td><td><span data-highlightingclass="Falcons">Team Falcons</span></td><td>100</td></tr>
      <tr data-toggle-area-content="1"><td>2</td><td><a title="esports:Gen.G">Gen.G</a></td><td>80</td></tr>
      <tr data-toggle-area-content="2"><td>1</td><td><span data-highlightingclass="Falcons">Team Falcons</span></td><td>200</td></tr>
      <tr data-toggle-area-content="2"><td>2</td><td><a title="esports:Gen.G">Gen.G</a></td><td>180</td></tr>
      <tr data-toggle-area-content="2"><td>3</td><td><a title="esports:T1">T1</a></td><td>150</td></tr>
      <tr data-toggle-area-content="2"><td>4</td><td><a title="esports:Vitality">Team Vitality</a></td><td>120</td></tr>
    </table>
  `;
  const $ = load(html);
  const rows = parseClubStandings($);

  // Only the latest week (area 2) rows should be returned.
  assert.equal(rows.length, 4);
  assert.equal(rows[0].points, 200, 'week-2 Falcons points');
  assert.equal(rows[1].points, 180, 'week-2 Gen.G points');
});

test('parseClubStandings: empty document returns []', () => {
  const $ = load('<html></html>');
  assert.deepEqual(parseClubStandings($), []);
});

test('parseClubStandings: table with header but zero data rows returns []', () => {
  // Only 1 row (the header) — fails the length > 5 guard.
  const html = `
    <table class="wikitable">
      <tr><th>#</th><th>Team</th><th>Points</th></tr>
    </table>
  `;
  const $ = load(html);
  assert.deepEqual(parseClubStandings($), []);
});

// ---------------------------------------------------------------------------
// parseEwcEventSchedule
// ---------------------------------------------------------------------------

// riyadhStartOfDay(year, month, day) = Math.floor(Date.UTC(year, month, day, -3, 0, 0) / 1000)
// 2026-07-08 UTC+3 start = 1783458000  (= 2026-07-07T21:00:00Z)
// 2026-07-13 end = riyadhStartOfDay(2026,6,14) - 1 = 1783976399
// 2026-06-30 UTC+3 start = 1782766800
// 2026-07-06 end = riyadhStartOfDay(2026,6,7) - 1 = 1783371599

test('parseEwcEventSchedule: same-month date range parses correctly', () => {
  const html = `
    <table class="table2__table">
      <tr><th>Game</th><th>Date</th><th>Event</th><th>Prize Pool</th><th>Participants</th></tr>
      <tr><th colspan="5">List of Tournaments at EWC</th></tr>
      <tr><th>Game</th><th>Date</th><th>Event</th><th>Prize Pool</th><th>Participants</th></tr>
      <tr>
        <td><a href="https://liquipedia.net/valorant/" title="valorant:VALORANT">VALORANT</a></td>
        <td>July 8 - 13, 2026</td>
        <td><a href="https://liquipedia.net/valorant/EWC/2026">EWC VALORANT 2026</a></td>
        <td>$500,000</td>
        <td>16</td>
      </tr>
    </table>
  `;
  const $ = load(html);
  const events = parseEwcEventSchedule($);

  assert.equal(events.length, 1, 'one event returned');
  const ev = events[0];
  assert.equal(ev.game, 'VALORANT');
  assert.equal(ev.dateLabel, 'July 8 - 13, 2026');
  assert.equal(ev.startAt, 1783458000, 'start epoch for 2026-07-08 UTC+3');
  assert.equal(ev.endAt, 1783976399, 'end epoch for end of 2026-07-13 UTC+3');
  assert.equal(ev.event, 'EWC VALORANT 2026');
  assert.equal(ev.prizePool, '$500,000');
  assert.equal(ev.participants, '16');
});

test('parseEwcEventSchedule: cross-month date range (June 30 - July 6) parses correctly', () => {
  const html = `
    <table class="table2__table">
      <tr><th colspan="5">List of Tournaments Prize Pool</th></tr>
      <tr><th>Game</th><th>Date</th><th>Event</th><th>Prize Pool</th><th>Participants</th></tr>
      <tr>
        <td><a href="https://liquipedia.net/rocketleague/" title="rocketleague:Rocket League">Rocket League</a></td>
        <td>June 30 - July 6, 2026</td>
        <td><a href="https://liquipedia.net/rocketleague/EWC/2026">EWC RL 2026</a></td>
        <td>$300,000</td>
        <td>12</td>
      </tr>
    </table>
  `;
  const $ = load(html);
  const events = parseEwcEventSchedule($);

  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.dateLabel, 'June 30 - July 6, 2026');
  assert.equal(ev.startAt, 1782766800, 'start epoch for 2026-06-30 UTC+3');
  assert.equal(ev.endAt, 1783371599, 'end epoch for end of 2026-07-06 UTC+3');
});

test('parseEwcEventSchedule: malformed date label results in startAt === null and row is excluded', () => {
  // The parser skips rows where !date.startAt, so malformed dates are dropped.
  const html = `
    <table class="table2__table">
      <tr><th colspan="5">List of Tournaments Prize Pool</th></tr>
      <tr><th>Game</th><th>Date</th><th>Event</th><th>Prize Pool</th><th>Participants</th></tr>
      <tr>
        <td><a href="https://liquipedia.net/valorant/" title="valorant:VALORANT">VALORANT</a></td>
        <td>TBD</td>
        <td><a href="https://liquipedia.net/valorant/EWC/2026">EWC VAL TBD</a></td>
        <td>$500,000</td>
        <td>16</td>
      </tr>
    </table>
  `;
  const $ = load(html);
  const events = parseEwcEventSchedule($);
  // Row with malformed date should be filtered out (startAt === null check in the parser).
  assert.equal(events.length, 0, 'malformed-date row is excluded');
});

test('parseEwcEventSchedule: events are sorted by startAt', () => {
  const html = `
    <table class="table2__table">
      <tr><th colspan="5">List of Tournaments Prize Pool</th></tr>
      <tr><th>Game</th><th>Date</th><th>Event</th><th>Prize Pool</th><th>Participants</th></tr>
      <tr>
        <td><a title="valorant:VALORANT">VALORANT</a></td>
        <td>July 8 - 13, 2026</td>
        <td>EWC VAL</td><td>$500k</td><td>16</td>
      </tr>
      <tr>
        <td><a title="rocketleague:Rocket League">Rocket League</a></td>
        <td>June 30 - July 6, 2026</td>
        <td>EWC RL</td><td>$300k</td><td>12</td>
      </tr>
    </table>
  `;
  const $ = load(html);
  const events = parseEwcEventSchedule($);
  assert.equal(events.length, 2);
  assert.ok(events[0].startAt < events[1].startAt, 'sorted ascending by startAt');
  assert.equal(events[0].game, 'Rocket League');
  assert.equal(events[1].game, 'VALORANT');
});

test('parseEwcEventSchedule: empty document returns []', () => {
  const $ = load('<html></html>');
  assert.deepEqual(parseEwcEventSchedule($), []);
});

// ---------------------------------------------------------------------------
// parseEwcClubs
// ---------------------------------------------------------------------------

test('parseEwcClubs: parses one club with roster entries', () => {
  // Header: columns 0-3 are fixed (Team Name, EWC Support, Q#, T#), then one game column.
  // ewcClubHeader reads a[title] first; "VAL" maps to "VALORANT" via EWC_GAME_LABELS.
  // shortLabel is cleanName(raw) = "VAL"; label is normalizeEwcGameLabel("VAL") = "VALORANT".
  const html = `
    <table class="wikitable sortable">
      <tr>
        <th>Team Name</th>
        <th>EWC Support</th>
        <th>Q#</th>
        <th>T#</th>
        <th><a href="https://liquipedia.net/valorant/" title="VAL"><img alt="VALORANT" src="/images/val.png" /></a></th>
      </tr>
      <tr>
        <td>
          <span data-highlightingclass="Team Falcons">Team Falcons</span>
          <a href="/esports/Team_Falcons"></a>
        </td>
        <td><a title="esports:Esports_World_Cup_Foundation">EWC Foundation</a></td>
        <td>3/5</td>
        <td>7</td>
        <td>
          <a href="/valorant/Player1" title="valorant:Player1">
            <i class="fas fa-check-circle"></i>
          </a>
          <a href="/valorant/Player2" title="valorant:Player2">
            <i class="fas fa-question"></i>
          </a>
        </td>
      </tr>
    </table>
  `;
  const $ = load(html);
  const result = parseEwcClubs($);

  assert.equal(result.games.length, 1, 'one game column detected');
  assert.equal(result.games[0].shortLabel, 'VAL', 'shortLabel is the raw title value');
  assert.equal(result.games[0].label, 'VALORANT', 'label is normalized via EWC_GAME_LABELS');

  assert.equal(result.clubs.length, 1, 'one club row parsed');
  const club = result.clubs[0];
  assert.equal(club.name, 'Team Falcons');
  assert.equal(club.qualifiedCount, 3);
  assert.equal(club.possibleEvents, 5);
  assert.equal(club.totalTeams, 7);

  assert.equal(club.games.length, 1);
  const ge = club.games[0];
  assert.equal(ge.status, 'qualified', 'first entry has check-circle → qualified');
  assert.equal(ge.entries.length, 2);
  assert.equal(ge.entries[0].name, 'Player1');
  assert.equal(ge.entries[0].status, 'qualified');
  assert.equal(ge.entries[1].name, 'Player2');
  assert.equal(ge.entries[1].status, 'can_qualify');
});

test('parseEwcClubs: missing required columns returns empty result', () => {
  const html = `
    <table class="wikitable sortable">
      <tr><th>Team Name</th><th>EWC Support</th></tr>
      <tr><td>Falcons</td><td>yes</td></tr>
    </table>
  `;
  const $ = load(html);
  const result = parseEwcClubs($);
  assert.deepEqual(result, { games: [], clubs: [] });
});

// ---------------------------------------------------------------------------
// parseSwissMatches
// ---------------------------------------------------------------------------

test('parseSwissMatches: finished match (decided score) has status finished', () => {
  // Use <th> for rank column so the rank number isn't mistaken for a team name.
  // Row team is read from the first td without swisstable-bgc that has a non-TBD teamName.
  const html = `
    <table class="swisstable">
      <tr><th>#</th><th>Team</th><th>Round 1</th></tr>
      <tr>
        <th>1</th>
        <td><span data-highlightingclass="Team A">Team A</span></td>
        <td class="swisstable-bgc-win">
          <span data-highlightingclass="Team B">Team B</span>
          2:0
        </td>
      </tr>
      <tr>
        <th>2</th>
        <td><span data-highlightingclass="Team B">Team B</span></td>
        <td class="swisstable-bgc-loss">
          <span data-highlightingclass="Team A">Team A</span>
          0:2
        </td>
      </tr>
    </table>
  `;
  const $ = load(html);
  const matches = parseSwissMatches($, 'rocketleague');

  assert.equal(matches.length, 1, 'mirror rows are deduped to one match');
  const m = matches[0];
  assert.equal(m.status, 'finished', 'decided score (2:0) → finished');
  assert.equal(m.scoreA, 2);
  assert.equal(m.scoreB, 0);
  assert.ok(m.winner, 'winner is set for decided match');
});

test('parseSwissMatches: tied score has status running', () => {
  // A 1:1 score means the match is still going (not decided).
  // Use <th> for rank column so the rank number isn't mistaken for a team name.
  const html = `
    <table class="swisstable">
      <tr><th>#</th><th>Team</th><th>Round 1</th></tr>
      <tr>
        <th>1</th>
        <td><span data-highlightingclass="Team A">Team A</span></td>
        <td class="swisstable-bgc-win">
          <span data-highlightingclass="Team B">Team B</span>
          1:1
        </td>
      </tr>
      <tr>
        <th>2</th>
        <td><span data-highlightingclass="Team B">Team B</span></td>
        <td class="swisstable-bgc-loss">
          <span data-highlightingclass="Team A">Team A</span>
          1:1
        </td>
      </tr>
    </table>
  `;
  const $ = load(html);
  const matches = parseSwissMatches($, 'rocketleague');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'running', 'tied score → running');
  assert.equal(matches[0].winner, null, 'no winner for tied match');
});

test('parseSwissMatches: empty document returns []', () => {
  const $ = load('<html></html>');
  assert.deepEqual(parseSwissMatches($, 'rl'), []);
});

test('parseSwissMatches: table with no played rounds returns []', () => {
  // No cells with swisstable-bgc class containing a score pattern.
  const html = `
    <table class="swisstable">
      <tr><th>#</th><th>Team</th><th>Matches</th></tr>
      <tr>
        <td>1</td>
        <td><span data-highlightingclass="Team A">Team A</span></td>
        <td>0-0</td>
      </tr>
    </table>
  `;
  const $ = load(html);
  assert.deepEqual(parseSwissMatches($, 'rl'), []);
});

// ---------------------------------------------------------------------------
// parseMatchlistMatch
// ---------------------------------------------------------------------------

test('parseMatchlistMatch: returns correct teams, scores, and status for a finished match', () => {
  const html = `
    <div class="brkts-matchlist-match">
      <div class="brkts-matchlist-opponent brkts-matchlist-slot-winner" aria-label="Team Alpha">
        <span class="name">Team Alpha</span>
      </div>
      <div class="brkts-matchlist-score">
        <span class="brkts-matchlist-cell-content">3</span>
        <span class="brkts-matchlist-cell-content">1</span>
      </div>
      <div class="brkts-matchlist-opponent" aria-label="Team Beta">
        <span class="name">Team Beta</span>
      </div>
    </div>
  `;
  const $ = load(html);
  const el = $('.brkts-matchlist-match')[0];
  const m = parseMatchlistMatch($, el, 'valorant', 'EWC/2026');

  assert.ok(m, 'should not return null');
  assert.equal(m.teamA, 'Team Alpha');
  assert.equal(m.teamB, 'Team Beta');
  assert.equal(m.scoreA, 3);
  assert.equal(m.scoreB, 1);
  assert.equal(m.status, 'finished', 'winner class → finished');
  assert.equal(m.winner, 'Team Alpha');
  assert.equal(m.source, 'liquipedia');
});

test('parseMatchlistMatch: unplayed match has status scheduled', () => {
  const futureTs = Math.floor(Date.now() / 1000) + 7200; // 2h from now
  const html = `
    <div class="brkts-matchlist-match">
      <div class="brkts-matchlist-opponent" aria-label="Team Alpha">
        <span class="name">Team Alpha</span>
      </div>
      <div class="brkts-matchlist-score">
        <span class="brkts-matchlist-cell-content"></span>
        <span class="brkts-matchlist-cell-content"></span>
      </div>
      <div class="brkts-matchlist-opponent" aria-label="Team Beta">
        <span class="name">Team Beta</span>
      </div>
      <span data-timestamp="${futureTs}"></span>
    </div>
  `;
  const $ = load(html);
  const el = $('.brkts-matchlist-match')[0];
  const m = parseMatchlistMatch($, el, 'valorant', 'EWC/2026');

  assert.ok(m);
  assert.equal(m.status, 'scheduled');
  assert.equal(m.scoreA, null);
  assert.equal(m.scoreB, null);
  assert.equal(m.winner, null);
});

test('parseMatchlistMatch: both TBD returns null', () => {
  const html = `
    <div class="brkts-matchlist-match">
      <div class="brkts-matchlist-opponent" aria-label="TBD"><span class="name">TBD</span></div>
      <div class="brkts-matchlist-score">
        <span class="brkts-matchlist-cell-content"></span>
        <span class="brkts-matchlist-cell-content"></span>
      </div>
      <div class="brkts-matchlist-opponent" aria-label="TBD"><span class="name">TBD</span></div>
    </div>
  `;
  const $ = load(html);
  const el = $('.brkts-matchlist-match')[0];
  assert.equal(parseMatchlistMatch($, el, 'valorant', 'EWC/2026'), null);
});

// ---------------------------------------------------------------------------
// parseBracketMatch
// ---------------------------------------------------------------------------

test('parseBracketMatch: finished match with brkts-opponent-win marker', () => {
  const html = `
    <div class="brkts-match">
      <div class="brkts-opponent-entry" aria-label="Natus Vincere">
        <span class="name">Natus Vincere</span>
        <span class="brkts-opponent-win"></span>
        <div class="brkts-opponent-score-inner">2</div>
      </div>
      <div class="brkts-opponent-entry" aria-label="G2 Esports">
        <span class="name">G2 Esports</span>
        <div class="brkts-opponent-score-inner">0</div>
      </div>
      <a href="/cs2/Match:100">Match details</a>
      <div class="brkts-popup">(Bo3)</div>
    </div>
  `;
  const $ = load(html);
  const el = $('.brkts-match')[0];
  const m = parseBracketMatch($, el, 'counterstrike', 'IEM/2026');

  assert.ok(m, 'should not be null');
  assert.equal(m.teamA, 'Natus Vincere');
  assert.equal(m.teamB, 'G2 Esports');
  assert.equal(m.scoreA, 2);
  assert.equal(m.scoreB, 0);
  assert.equal(m.status, 'finished', 'win marker → finished');
  assert.equal(m.winner, 'Natus Vincere');
  assert.equal(m.bestOf, 3);
  assert.equal(m.externalId, 'Match:100', 'prefers Match: href id');
});

test('parseBracketMatch: upcoming match with future timestamp has status scheduled', () => {
  const futureTs = Math.floor(Date.now() / 1000) + 7200;
  const html = `
    <div class="brkts-match">
      <div class="brkts-opponent-entry" aria-label="Team A">
        <span class="name">Team A</span>
        <div class="brkts-opponent-score-inner"></div>
      </div>
      <div class="brkts-opponent-entry" aria-label="Team B">
        <span class="name">Team B</span>
        <div class="brkts-opponent-score-inner"></div>
      </div>
      <span data-timestamp="${futureTs}"></span>
    </div>
  `;
  const $ = load(html);
  const el = $('.brkts-match')[0];
  const m = parseBracketMatch($, el, 'valorant', 'EWC/2026');

  assert.ok(m);
  assert.equal(m.status, 'scheduled');
  assert.equal(m.scoreA, null);
  assert.equal(m.scoreB, null);
  assert.equal(m.winner, null);
});

test('parseBracketMatch: both TBD slots return null', () => {
  const html = `
    <div class="brkts-match">
      <div class="brkts-opponent-entry" aria-label="TBD"><span class="name">TBD</span></div>
      <div class="brkts-opponent-entry" aria-label="TBD"><span class="name">TBD</span></div>
    </div>
  `;
  const $ = load(html);
  const el = $('.brkts-match')[0];
  assert.equal(parseBracketMatch($, el, 'valorant', 'EWC/2026'), null);
});

// ---------------------------------------------------------------------------
// parseMatchInfo
// ---------------------------------------------------------------------------

test('parseMatchInfo: parses teams, scores, and scheduled time from a match-info block', () => {
  const scheduledAt = 1783458000; // 2026-07-08 UTC+3 start
  // 3:1 in a Bo5: winAt = ceil(5/2)+1 = 3; scoreA=3 >= 3 → finished.
  const html = `
    <div class="match-info">
      <div class="match-info-header-opponent">
        <div class="block-team">
          <a title="Team Liquid">Team Liquid</a>
        </div>
      </div>
      <div class="match-info-header-scoreholder-upper">3 : 1</div>
      <div class="match-info-header-scoreholder-lower">Bo5</div>
      <div class="match-info-header-opponent">
        <div class="block-team">
          <a title="Cloud9">Cloud9</a>
        </div>
      </div>
      <span class="timer-object" data-timestamp="${scheduledAt}"></span>
      <div class="match-info-tournament">
        <a href="/valorant/EWC/2026">
          <span class="match-info-tournament-name">EWC 2026</span>
        </a>
      </div>
      <a href="/valorant/Match:999">View match details</a>
    </div>
  `;
  const $ = load(html);
  const el = $('.match-info')[0];
  const m = parseMatchInfo($, el, 'valorant');

  assert.ok(m, 'should not be null');
  assert.equal(m.teamA, 'Team Liquid');
  assert.equal(m.teamB, 'Cloud9');
  assert.equal(m.scoreA, 3);
  assert.equal(m.scoreB, 1);
  assert.equal(m.bestOf, 5);
  assert.equal(m.scheduledAt, scheduledAt);
  assert.equal(m.tournamentName, 'EWC 2026');
  assert.equal(m.status, 'finished', 'Bo5 with 3:1 reaches win threshold (winAt=3) → finished');
});

test('parseMatchInfo: no teams, no scores, future schedule → status scheduled', () => {
  const futureTs = Math.floor(Date.now() / 1000) + 86400;
  const html = `
    <div class="match-info">
      <div class="match-info-header-opponent">
        <div class="block-team">
          <a title="Team Liquid">Team Liquid</a>
        </div>
      </div>
      <div class="match-info-header-scoreholder-upper">vs</div>
      <div class="match-info-header-opponent">
        <div class="block-team">
          <a title="Cloud9">Cloud9</a>
        </div>
      </div>
      <span class="timer-object" data-timestamp="${futureTs}"></span>
      <div class="match-info-tournament">
        <a href="/valorant/EWC/2026">
          <span class="match-info-tournament-name">EWC 2026</span>
        </a>
      </div>
    </div>
  `;
  const $ = load(html);
  const el = $('.match-info')[0];
  const m = parseMatchInfo($, el, 'valorant');

  assert.ok(m);
  assert.equal(m.status, 'scheduled');
  assert.equal(m.scoreA, null);
  assert.equal(m.scoreB, null);
});
