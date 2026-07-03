import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as cheerio from 'cheerio';

import {
  parseBattleRoyaleParticipantGroups,
  parseBattleRoyaleSchedules,
  hasStandingsRows,
  parseBattleRoyaleStandings,
  parseEventStandings,
  parseGroupTableStandings,
} from '../src/services/liquipedia/standingsParsers.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const br$ = cheerio.load(readFileSync(join(fixtures, 'liquipedia-br-standings.html'), 'utf8'));
const group$ = cheerio.load(readFileSync(join(fixtures, 'liquipedia-group-standings.html'), 'utf8'));

test('battle-royale panel-table parses rank/team/points with section title', () => {
  const sections = parseBattleRoyaleStandings(br$);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, 'Group Stage');
  const [first, second, tbd] = sections[0].entries;
  assert.deepEqual(
    { rank: first.rank, team: first.team, points: first.points },
    { rank: 1, team: 'Twisted Minds', points: '87' },
  );
  assert.match(first.logo, /^https:\/\//);
  assert.equal(second.team, 'Falcons Force');
  assert.equal(second.logo, null);
  // TBD rows are kept (they become real once qualifiers finish) with a fallback rank.
  assert.equal(tbd.team, 'TBD');
  assert.equal(tbd.rank, 3);
});

test('battle-royale group draw wins over all-zero lobby standings before results start', () => {
  const $ = cheerio.load(`
    <h2><span class="mw-headline">Group Draw</span></h2>
    <table class="wikitable">
      <tr><th>Group A</th><th>Group B</th></tr>
      <tr>
        <td>
          <span class="flag"><img src="/commons/images/flag.png"></span>
          <span data-highlightingclass="ZETA DIVISION">
            <span class="team-template-image-icon"><img src="/commons/images/zeta.png"></span>
            <span class="team-template-text">ZETA</span>
          </span>
        </td>
        <td><span data-highlightingclass="Wolves Esports">Wolves</span></td>
      </tr>
      <tr>
        <td><span data-highlightingclass="JD Gaming">JDG</span></td>
        <td><span data-highlightingclass="Virtus.pro">VP</span></td>
      </tr>
    </table>
    <div class="tabs-dynamic">
      <div class="navigation-tabs__list-item">A vs B</div>
      <div class="panel-content">
        <div class="panel-table">
          <div class="panel-table__row row--header"></div>
          <div class="panel-table__row">
            <div class="cell--rank" data-sort-val="1"></div>
            <div class="cell--team" data-sort-val="ZETA DIVISION"></div>
            <div class="cell--total-points" data-sort-val="0"></div>
          </div>
          <div class="panel-table__row">
            <div class="cell--rank" data-sort-val="2"></div>
            <div class="cell--team" data-sort-val="Wolves Esports"></div>
            <div class="cell--total-points" data-sort-val="0"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  const groups = parseBattleRoyaleParticipantGroups($);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Group A');
  assert.equal(groups[0].entries[0].team, 'ZETA DIVISION');
  assert.match(groups[0].entries[0].logo, /zeta/);

  const sections = parseEventStandings($);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, 'Group A');
  assert.deepEqual(sections[0].entries.map((entry) => entry.team), ['ZETA DIVISION', 'JD Gaming']);
  assert.deepEqual(sections[1].entries.map((entry) => entry.team), ['Wolves Esports', 'Virtus.pro']);
});

test('battle-royale navigation wrapper titles Free Fire groups and skips future placeholder sections', () => {
  const futureTs = Math.floor(Date.now() / 1000) + 24 * 3600;
  const $ = cheerio.load(`
    <div class="brkts-br-wrapper battle-royale">
      <div class="navigation-tabs">
        <ul class="navigation-tabs__list">
          <li class="navigation-tabs__list-item">Group A</li>
          <li class="navigation-tabs__list-item">Group B</li>
        </ul>
      </div>
      <div class="navigation-content-container">
        <div class="navigation-content">
          <div class="panel-content">
            <ul class="panel-content__game-schedule">
              <li class="panel-content__game-schedule__list-item">
                <span class="panel-content__game-schedule__title">Game 1:</span>
                <span data-timestamp="${futureTs}">Soon</span>
              </li>
            </ul>
            <div class="panel-table">
              <div class="panel-table__row row--header"></div>
              <div class="panel-table__row">
                <div class="cell--rank" data-sort-val="1"></div>
                <div class="cell--team" data-sort-val="All Gamers Global">
                  <img src="/commons/images/all-gamers.png">
                </div>
                <div class="cell--total-points" data-sort-val="0"></div>
              </div>
              <div class="panel-table__row">
                <div class="cell--rank" data-sort-val="2"></div>
                <div class="cell--team" data-sort-val="Aurora Gaming"></div>
                <div class="cell--total-points" data-sort-val="0"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="navigation-content">
          <div class="panel-content">
            <ul class="panel-content__game-schedule">
              <li class="panel-content__game-schedule__list-item">
                <span class="panel-content__game-schedule__title">Game 1:</span>
                <span data-timestamp="${futureTs + 3600}">Soon</span>
              </li>
            </ul>
            <div class="panel-table">
              <div class="panel-table__row row--header"></div>
              <div class="panel-table__row">
                <div class="cell--rank" data-sort-val="1"></div>
                <div class="cell--team" data-sort-val="Al Ahli Esports"></div>
                <div class="cell--total-points" data-sort-val="0"></div>
              </div>
              <div class="panel-table__row">
                <div class="cell--rank" data-sort-val="2"></div>
                <div class="cell--team" data-sort-val="Fluxo W7M"></div>
                <div class="cell--total-points" data-sort-val="0"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="brkts-br-wrapper battle-royale">
      <div class="navigation-tabs is--hidden">
        <ul class="navigation-tabs__list">
          <li class="navigation-tabs__list-item">Survival Stage</li>
        </ul>
      </div>
      <div class="navigation-content-container">
        <div class="navigation-content">
          <div class="panel-content">
            <ul class="panel-content__game-schedule">
              <li class="panel-content__game-schedule__list-item">
                <span class="panel-content__game-schedule__title">Match:</span>
                <span data-timestamp="${futureTs + 7200}">Soon</span>
              </li>
            </ul>
            <div class="panel-table">
              <div class="panel-table__row row--header"></div>
              <div class="panel-table__row">
                <div class="cell--rank" data-sort-val="1"></div>
                <div class="cell--team" data-sort-val="Group A #05"></div>
                <div class="cell--total-points" data-sort-val=""></div>
              </div>
              <div class="panel-table__row">
                <div class="cell--rank" data-sort-val="2"></div>
                <div class="cell--team" data-sort-val="Group B #10"></div>
                <div class="cell--total-points" data-sort-val=""></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  const sections = parseEventStandings($);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, 'Group A');
  assert.deepEqual(sections[0].entries.map((entry) => entry.team), ['All Gamers Global', 'Aurora Gaming']);
  assert.match(sections[0].entries[0].logo, /all-gamers/);
  assert.equal(sections[1].title, 'Group B');
  assert.deepEqual(sections[1].entries.map((entry) => entry.team), ['Al Ahli Esports', 'Fluxo W7M']);

  const schedules = parseBattleRoyaleSchedules($, 'freefire', 'Esports_World_Cup/2026');
  assert.deepEqual(
    schedules.map((match) => match.name),
    ['Group A - Game 1', 'Group B - Game 1', 'Survival Stage - Match'],
  );
});

test('battle-royale schedule rows parse as lobby calendar items', () => {
  const futureTs = Math.floor(Date.now() / 1000) + 24 * 3600;
  const $ = cheerio.load(`
    <div class="tabs-dynamic">
      <div class="navigation-tabs__list-item">A vs B</div>
      <div class="panel-content">
        <div class="panel-content__collapsible">
          <h5><span>Schedule</span></h5>
          <ul class="panel-content__game-schedule">
            <li class="panel-content__game-schedule__list-item">
              <span class="panel-content__game-schedule__title">Game 1:</span>
              <span class="timer-object" data-timestamp="${futureTs}">Soon</span>
            </li>
          </ul>
        </div>
        <div class="panel-table">
          <div class="panel-table__row row--header"></div>
          <div class="panel-table__row">
            <div class="cell--rank" data-sort-val="1"></div>
            <div class="cell--team" data-sort-val="ZETA DIVISION"></div>
            <div class="cell--total-points" data-sort-val="0"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  const [match] = parseBattleRoyaleSchedules($, 'apexlegends', 'Apex/Page/Group_Stage', 'Group Stage');
  assert.equal(match.name, 'Group Stage - A vs B - Game 1');
  assert.equal(match.teamA, 'Group Stage - A vs B - Game 1');
  assert.equal(match.teamB, 'Lobby');
  assert.equal(match.scheduledAt, futureTs);
  assert.equal(match.status, 'scheduled');
  assert.match(match.externalId, /^apexlegends:br-schedule:/);
});

test('group-table parses group title, aria-label team, match + game scores', () => {
  const sections = parseGroupTableStandings(group$);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, 'Group A');
  const [weibo, falcons] = sections[0].entries;
  assert.deepEqual(
    { rank: weibo.rank, team: weibo.team, points: weibo.points, extra: weibo.extra },
    { rank: 1, team: 'Weibo Gaming', points: '2–0', extra: '4–1' },
  );
  assert.match(weibo.logo, /Weibo_allmode/);
  assert.equal(falcons.rank, 2); // blank rank cell falls back to position
});

test('parseEventStandings combines both formats and empty pages yield []', () => {
  assert.equal(parseEventStandings(br$).length, 1);
  assert.equal(parseEventStandings(group$).length, 1);
  const empty$ = cheerio.load('<div class="mw-parser-output"><p>Nothing here.</p></div>');
  assert.deepEqual(parseEventStandings(empty$), []);
});

test('an all-TBD table (unseeded event) yields no section', () => {
  // PUBG / PUBG Mobile / early Apex events list every slot as TBD until their
  // qualifiers finish — storing that would be a page of "1. TBD, 2. TBD, ...".
  const allTbd$ = cheerio.load(`
    <div class="panel-table">
      <div class="panel-table__row row--header"><div class="cell--rank">#</div></div>
      <div class="panel-table__row">
        <div class="cell--rank" data-sort-val="1">1</div>
        <div class="cell--team" data-sort-val="TBD"><div class="block-team"><span class="name">TBD</span></div></div>
      </div>
      <div class="panel-table__row">
        <div class="cell--rank" data-sort-val="2">2</div>
        <div class="cell--team" data-sort-val="TBD"><div class="block-team"><span class="name">TBD</span></div></div>
      </div>
    </div>`);
  assert.deepEqual(parseBattleRoyaleStandings(allTbd$), []);
  assert.deepEqual(parseEventStandings(allTbd$), []);
  // But rows WERE parsed — this is the clear-vs-preserve confidence signal.
  assert.equal(hasStandingsRows(allTbd$), true);
});

test('hasStandingsRows is false when the DOM has no parseable rows (preserve guard)', () => {
  // A real page yields rows; the fixture has Twisted Minds etc.
  assert.equal(hasStandingsRows(br$), true);
  assert.equal(hasStandingsRows(group$), true);
  // A table container whose rows/cells changed shape yields nothing — the sync
  // must PRESERVE stored rows in this case, not wipe them.
  const shapeChanged$ = cheerio.load(
    '<div class="panel-table"><div class="some-new-row"><div class="some-new-team">Twisted Minds</div></div></div>',
  );
  assert.equal(hasStandingsRows(shapeChanged$), false);
  const emptyTable$ = cheerio.load('<div class="panel-table"></div>');
  assert.equal(hasStandingsRows(emptyTable$), false);
  assert.equal(hasStandingsRows(cheerio.load('<div><p>no standings</p></div>')), false);
});
