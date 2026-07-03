import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as cheerio from 'cheerio';

import {
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
