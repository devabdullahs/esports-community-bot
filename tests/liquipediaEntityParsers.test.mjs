import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as cheerio from 'cheerio';

import {
  findTeamRosterTable,
  normalizeEntityFacts,
  parseEntityInfobox,
  parseTeamRoster,
} from '../src/services/liquipedia/entityParsers.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const team$ = cheerio.load(readFileSync(join(fixtures, 'liquipedia-team-entity.html'), 'utf8'));
const team2$ = cheerio.load(readFileSync(join(fixtures, 'liquipedia-team-entity-table2.html'), 'utf8'));
const player$ = cheerio.load(readFileSync(join(fixtures, 'liquipedia-player-entity.html'), 'utf8'));

test('team infobox parses name, image, and normalized label facts', () => {
  const infobox = parseEntityInfobox(team$);
  assert.equal(infobox.name, 'Twisted Minds');
  assert.match(infobox.image, /^https:\/\//); // relative src normalized to absolute
  assert.equal(infobox.facts.location, 'Saudi Arabia');
  assert.equal(infobox.facts.region, 'MENA');
  assert.equal(infobox.facts.coach, 'CoachGuy'); // footnote marker stripped
  assert.equal(infobox.facts.approx_total_winnings, '$1,234,567');
  assert.equal(infobox.facts.created, '2021-03-30');
});

test('team roster takes the ACTIVE roster card only, with page links', () => {
  const { players: roster, truncated } = parseTeamRoster(team$);
  assert.equal(truncated, false);
  assert.equal(roster.length, 2); // OldGuy (Former table) excluded
  assert.deepEqual(roster[0], { name: 'M0nkey M00n', page: 'M0nkey_M00n', role: null });
  assert.equal(roster[1].name, 'Extra');
  assert.equal(roster[1].page, 'Extra');
  assert.equal(roster[1].role, 'Striker'); // "Position:" prefix stripped
});

// Liquipedia replaced `table.roster-card` with the `table2` component in 2026;
// prod showed 0/197 parsed team pages matching the old selector (so zero players
// were ever enriched). This fixture is trimmed from a REAL post-migration page.
test('team roster parses the current table2 markup (active squad only)', () => {
  const { players: roster, truncated } = parseTeamRoster(team2$);
  assert.equal(truncated, false);
  assert.equal(roster.length, 2, 'former-players and results tables are excluded');
  assert.deepEqual(roster[0], { name: 'Ekşi', page: 'EKSI', role: 'EXP Lane' });
  assert.deepEqual(roster[1], { name: 'Caddy', page: 'Caddy', role: 'Jungler' });
  // infobox still parses alongside the new roster markup
  const infobox = parseEntityInfobox(team2$);
  assert.equal(infobox.name, 'FUT Esports');
  assert.equal(infobox.facts.location, 'Turkey');
});

test('a page with ONLY a former-players table2 yields an empty roster (never ex-players)', () => {
  const $ = cheerio.load(`
    <table class="table2__table"><tbody>
      <tr class="table2__row--head"><th>ID</th><th>Name</th><th>Position</th><th>Join Date</th><th>Leave Date</th><th>New Team</th></tr>
      <tr class="table2__row--body"><td><a href="/valorant/Gone">Gone</a></td><td>Ex Player</td><td>Duelist</td><td>2024-01-01</td><td>2025-01-01</td><td>Elsewhere</td></tr>
    </tbody></table>
  `);
  assert.equal(findTeamRosterTable($), null);
  assert.deepEqual(parseTeamRoster($), { players: [], truncated: false });
});

test('legacy roster-card still wins when both formats are absent/present', () => {
  // The legacy fixture keeps parsing exactly as before (regression guard).
  const table = findTeamRosterTable(team$);
  assert.ok(table.is('table.roster-card'));
});

test('player infobox parses bio facts', () => {
  const infobox = parseEntityInfobox(player$);
  assert.equal(infobox.name, 'M0nkey M00n');
  assert.match(infobox.image, /^https:\/\/liquipedia\.net/); // protocol-relative normalized
  const n = normalizeEntityFacts(infobox.facts);
  assert.equal(n.romanizedName, 'Evan Rogez');
  assert.equal(n.nationality, 'France');
  assert.equal(n.team, 'Twisted Minds');
  assert.equal(n.role, 'Player');
  assert.equal(n.totalWinnings, '$987,654');
});

test('pages without an infobox return null instead of garbage', () => {
  const empty$ = cheerio.load('<div class="mw-parser-output"><p>Disambiguation.</p></div>');
  assert.equal(parseEntityInfobox(empty$), null);
  assert.deepEqual(parseTeamRoster(empty$), { players: [], truncated: false });
});
