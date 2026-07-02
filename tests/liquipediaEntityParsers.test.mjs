import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as cheerio from 'cheerio';

import {
  normalizeEntityFacts,
  parseEntityInfobox,
  parseTeamRoster,
} from '../src/services/liquipedia/entityParsers.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const team$ = cheerio.load(readFileSync(join(fixtures, 'liquipedia-team-entity.html'), 'utf8'));
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
  const roster = parseTeamRoster(team$);
  assert.equal(roster.length, 2); // OldGuy (Former table) excluded
  assert.deepEqual(roster[0], { name: 'M0nkey M00n', page: 'M0nkey_M00n', role: null });
  assert.equal(roster[1].name, 'Extra');
  assert.equal(roster[1].page, 'Extra');
  assert.equal(roster[1].role, 'Striker'); // "Position:" prefix stripped
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
  assert.deepEqual(parseTeamRoster(empty$), []);
});
