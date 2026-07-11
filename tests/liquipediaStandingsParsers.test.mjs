import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as cheerio from 'cheerio';

import {
  parseBattleRoyaleParticipantGroups,
  parseBattleRoyaleSchedules,
  mergeBattleRoyaleSchedules,
  mergeStandingsSectionAliases,
  parseParticipantTables,
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

test('battle-royale schedule rows trust Liquipedia game state icons', () => {
  const now = Math.floor(Date.now() / 1000);
  const $ = cheerio.load(`
    <div class="brkts-br-wrapper battle-royale">
      <div class="navigation-tabs">
        <ul class="navigation-tabs__list">
          <li class="navigation-tabs__list-item"><i class="fas fa-circle icon--red navigation-tabs__list-item-icon"></i>A vs B</li>
        </ul>
      </div>
      <div class="navigation-content-container">
        <div class="navigation-content">
          <div class="panel-content">
            <ul class="panel-content__game-schedule">
              <li class="panel-content__game-schedule__list-item">
                <span class="panel-content__game-schedule__icon"><i class="fas fa-check icon--green"></i></span>
                <span class="panel-content__game-schedule__title">Game 1:</span>
                <span class="timer-object" data-timestamp="${now - 1800}" data-finished="finished"></span>
              </li>
              <li class="panel-content__game-schedule__list-item">
                <span class="panel-content__game-schedule__icon"><i class="fas fa-circle icon--red"></i></span>
                <span class="panel-content__game-schedule__title">Game 2:</span>
                <span class="timer-object" data-timestamp="${now + 3600}"></span>
              </li>
              <li class="panel-content__game-schedule__list-item">
                <span class="panel-content__game-schedule__icon"><i class="far fa-clock"></i></span>
                <span class="panel-content__game-schedule__title">Game 3:</span>
                <span class="timer-object" data-timestamp="${now + 7200}"></span>
              </li>
            </ul>
            <div class="panel-table">
              <div class="panel-table__row row--header"></div>
              <div class="panel-table__row">
                <div class="cell--rank" data-sort-val="1"></div>
                <div class="cell--team" data-sort-val="Team Falcons"></div>
                <div class="cell--total-points" data-sort-val="31"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  const matches = parseBattleRoyaleSchedules($, 'apexlegends', 'Apex/Page/Group_Stage', 'Group Stage');
  assert.deepEqual(matches.map((match) => match.status), ['finished', 'running', 'scheduled']);
});

test('battle-royale standings collapse responsive row clones by team', () => {
  const $ = cheerio.load(`
    <div class="panel-table">
      ${[38, 38, 38].map((points) => `
        <div class="panel-table__row">
          <div class="cell--rank" data-sort-val="1"></div>
          <div class="cell--team" data-sort-val="Wolves Esports"></div>
          <div class="cell--total-points" data-sort-val="${points}"></div>
        </div>`).join('')}
    </div>`);
  const sections = parseBattleRoyaleStandings($);
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].entries.map((entry) => [entry.team, entry.points]), [['Wolves Esports', '38']]);
});

test('battle-royale schedules collapse parent/child stage twins and repair shifted game labels', () => {
  const schedule = (name, scheduledAt, status = 'scheduled', page = 'overview') => ({
    source: 'liquipedia',
    externalId: `apexlegends:br-schedule:${page}:${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    teamA: name,
    teamB: 'Lobby',
    scheduledAt,
    status,
  });
  const merged = mergeBattleRoyaleSchedules([
    schedule('Grand Final - Game 1', 1000, 'running'),
    schedule('Grand Final - Game 2', 2000),
    schedule('Grand Final - Game 3', 3000),
    schedule('Finals - Grand Final - Game 1', 2000, 'running', 'finals'),
    schedule('Finals - Grand Final - Game 2', 3000, 'finished', 'finals'),
    schedule('Finals - Grand Final - Game 3', 4000, 'scheduled', 'finals'),
  ]);

  assert.deepEqual(merged.map((match) => match.name), [
    'Grand Final - Game 1',
    'Grand Final - Game 2',
    'Grand Final - Game 3',
    'Grand Final - Game 4',
  ]);
  assert.deepEqual(merged.map((match) => match.status), ['running', 'running', 'finished', 'scheduled']);
  assert.deepEqual(merged.map((match) => match.teamA), merged.map((match) => match.name));
});

test('battle-royale schedule merge keeps distinct simultaneous lobby sections', () => {
  const base = {
    source: 'liquipedia',
    teamB: 'Lobby',
    scheduledAt: 1000,
    status: 'scheduled',
  };
  const merged = mergeBattleRoyaleSchedules([
    { ...base, externalId: 'a', name: 'Group Stage - A vs B - Game 1', teamA: 'A vs B' },
    { ...base, externalId: 'b', name: 'Group Stage - C vs D - Game 1', teamA: 'C vs D' },
  ]);
  assert.equal(merged.length, 2);
});

test('standings merge treats Grand Final and Finals-prefixed Grand Final as one field', () => {
  const teams = ['Wolves Esports', 'RRQ', 'Team Vision'];
  const section = (title, points) => ({
    title,
    entries: teams.map((team, index) => ({ rank: index + 1, team, points: String(points[index]), extra: '' })),
  });
  const merged = mergeStandingsSectionAliases([
    section('Grand Final', [0, 0, 0]),
    section('Finals: Grand Final', [38, 37, 35]),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Finals: Grand Final');
  assert.deepEqual(merged[0].entries.map((entry) => entry.points), ['38', '37', '35']);
});

test('standings merge keeps different participant fields with similar titles', () => {
  const merged = mergeStandingsSectionAliases([
    { title: 'Grand Final', entries: [{ rank: 1, team: 'Alpha', points: '10', extra: '' }] },
    { title: 'Finals: Grand Final', entries: [{ rank: 1, team: 'Bravo', points: '12', extra: '' }] },
  ]);
  assert.equal(merged.length, 2);
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

test('participant-table parses individual-player EWC qualifier fields', () => {
  const $ = cheerio.load(`
    <h2><span class="mw-headline">Participants</span></h2>
    <div class="participantTable">
      <div class="participantTable-title">Invited</div>
      <div class="participantTable-row">
        <div class="participantTable-title">EWC 2025 Champion <i>(1)</i></div>
      </div>
      <div class="participantTable-row">
        <div class="participantTable-entry brkts-opponent-hover" aria-label="GO1">
          <div class="block-player has-team">
            <span class="flag"><img src="/commons/images/jp.png"></span>
            <span class="race"><img src="/commons/images/mr-karate.png"></span>
            <span class="name"><a href="/fighters/GO1" title="GO1">GO1</a></span>
            <span class="team-template-image-icon"><img src="/commons/images/dfm.png"></span>
          </div>
        </div>
        <div class="participantTable-entry participantTable-empty"></div>
      </div>
    </div>
    <div class="participantTable">
      <div class="participantTable-title">Qualified</div>
      <div class="participantTable-row">
        <div class="participantTable-title">GEMA LIVE <i>(1)</i></div>
      </div>
      <div class="participantTable-row">
        <div class="participantTable-entry brkts-opponent-hover" aria-label="DarkAngel">
          <div class="block-player"><span class="name">DarkAngel</span></div>
        </div>
      </div>
      <div class="participantTable-row">
        <div class="participantTable-title">DreamHack Birmingham 2026 <i>(4)</i></div>
      </div>
      <div class="participantTable-row">
        <div class="participantTable-entry brkts-opponent-hover" aria-label="ZJZ"><div class="block-player"><span class="name">ZJZ</span></div></div>
        <div class="participantTable-entry brkts-opponent-hover" aria-label="Basher"><div class="block-player"><span class="name">Basher</span></div></div>
        <div class="participantTable-entry brkts-opponent-hover" aria-label="Dany"><div class="block-player"><span class="name">Dany "El Maza"</span></div></div>
      </div>
    </div>
  `);

  const sections = parseParticipantTables($);
  assert.deepEqual(
    sections.map((section) => ({ title: section.title, teams: section.entries.map((entry) => entry.team) })),
    [
      { title: 'Invited: EWC 2025 Champion (1)', teams: ['GO1'] },
      { title: 'Qualified: GEMA LIVE (1)', teams: ['DarkAngel'] },
      { title: 'Qualified: DreamHack Birmingham 2026 (4)', teams: ['ZJZ', 'Basher', 'Dany "El Maza"'] },
    ],
  );
  assert.match(sections[0].entries[0].logo, /dfm/);
  assert.equal(hasStandingsRows($), true);
  assert.deepEqual(parseEventStandings($).flatMap((section) => section.entries.map((entry) => entry.team)), [
    'GO1',
    'DarkAngel',
    'ZJZ',
    'Basher',
    'Dany "El Maza"',
  ]);
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
