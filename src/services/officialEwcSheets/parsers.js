import { createHash } from 'node:crypto';
import { isLobbyGame } from '../../lib/games.js';
import { normalizeTeamName } from '../../lib/render.js';

const MAX_CELL_LENGTH = 500;
const MAX_FACTS = 40;
const MAX_SECTIONS = 30;
const MAX_ENTRIES = 80;
const SCHEDULE_DATE_HEADERS = ['date', 'match date', 'match day'];
const SCHEDULE_TIME_HEADERS = [
  'start time',
  'time',
  'match time',
  'start time ksa',
  'time ksa',
  'match time ksa',
];
const SCHEDULE_MATCH_HEADERS = ['match', 'matches', 'matchup', 'fixture', 'match name'];

const PUBLIC_OVERVIEW_FACT_KEYS = new Set([
  'format',
  'tournament format',
  'prize pool',
  'platform',
  'game mode',
  'mode',
  'number of teams',
  'total number of teams',
  'number of players',
  'total number of players',
  'number of participants',
  'total number of participants',
  'number of matches',
  'total number of matches',
]);

const WORKBOOK_GAME_ALIASES = new Map([
  ['apex', { game: 'apexlegends' }],
  ['apex legends', { game: 'apexlegends' }],
  // Both Call of Duty events store their tournament under the `callofduty` game, so each
  // needs a needle: without one, whichever workbook resolves first claims the only active
  // Call of Duty tournament. Black Ops 7 has no tracked tournament yet and stays unresolved
  // until one appears, which is the correct outcome — better than landing in Warzone's.
  ['call of duty black ops 7', { game: 'callofduty', tournamentNeedle: ['black ops', 'bo7'] }],
  ['chess', { game: 'chess' }],
  ['counter-strike 2', { game: 'counterstrike' }],
  ['crossfire', { game: 'crossfire' }],
  ['dota 2', { game: 'dota2' }],
  ['dota2', { game: 'dota2' }],
  ['ea sports fc 26', { game: 'easportsfc', tournamentNeedle: 'world championship' }],
  ['ea fc 26', { game: 'easportsfc', tournamentNeedle: 'world championship' }],
  ['fatal fury', { game: 'fighters', tournamentNeedle: 'fatal fury' }],
  ['fortnite', { game: 'fortnite' }],
  ['free fire', { game: 'freefire' }],
  ['honor of kings', { game: 'honorofkings' }],
  ['league of legends', { game: 'leagueoflegends' }],
  ['mobile legends bang bang women', { game: 'mobilelegends', tournamentNeedle: 'women' }],
  ["mobile legends women's invitational", { game: 'mobilelegends', tournamentNeedle: 'women' }],
  ['mwi', { game: 'mobilelegends', tournamentNeedle: 'women' }],
  ['mobile legends bang bang', { game: 'mobilelegends', tournamentNeedle: 'mid season cup' }],
  ['overwatch', { game: 'overwatch' }],
  ['overwatch 2', { game: 'overwatch' }],
  ['pubg', { game: 'pubg' }],
  ['pubg mobile', { game: 'pubgmobile' }],
  ['rainbow six siege', { game: 'rainbowsix' }],
  ['rainbow six siege x', { game: 'rainbowsix' }],
  ['rocket league', { game: 'rocketleague', tournamentNeedle: 'featuring rocket league' }],
  ['street fighter 6', { game: 'fighters', tournamentNeedle: 'street fighter' }],
  ['teamfight tactics', { game: 'tft' }],
  ['tekken 8', { game: 'fighters', tournamentNeedle: 'tekken' }],
  ['trackmania', { game: 'trackmania' }],
  ['valorant', { game: 'valorant' }],
  ['warzone', { game: 'callofduty', tournamentNeedle: 'warzone' }],
]);

function text(value) {
  if (value === null || value === undefined) return '';
  const result = String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!result || result.startsWith('=')) return '';
  return result.slice(0, MAX_CELL_LENGTH);
}

function publicOverviewText(value) {
  const result = text(value);
  if (!result || /https?:\/\/|docs\.google|drive\.google|spreadsheets\/d\//i.test(result)) return '';
  return result;
}

function normalizedHeader(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedTitle(value) {
  return text(value)
    .replace(/^\[public\]\s*/i, '')
    .split('|')[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Several games run a last-chance qualifier as its OWN workbook and its own tournament,
// under the same game and with a name the main event's needle also matches — "TEKKEN 8"
// matches both the main bracket and "…: TEKKEN 8 - LCQ". Two candidates is not unique, so
// resolution failed and the main event was never ingested at all. Tag both sides instead.
export const LCQ_PATTERN = /\blcq\b|last chance qualifier/i;

export function isLcqLabel(value) {
  return LCQ_PATTERN.test(String(value ?? ''));
}

export function workbookDescriptor(title) {
  const label = normalizedTitle(title);
  if (!label) return null;
  const lcq = isLcqLabel(label);
  if (WORKBOOK_GAME_ALIASES.has(label)) return { label, lcq, ...WORKBOOK_GAME_ALIASES.get(label) };
  for (const [key, descriptor] of [...WORKBOOK_GAME_ALIASES].sort(([a], [b]) => b.length - a.length)) {
    const comparableLabel = normalizedHeader(label);
    const comparableKey = normalizedHeader(key);
    if (comparableLabel.includes(comparableKey) || comparableKey.includes(comparableLabel)) {
      return { label, lcq, ...descriptor };
    }
  }
  return null;
}

function headerIndex(row, aliases) {
  const normalized = row.map(normalizedHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index >= 0) return index;
  }
  // A header can pick up an annotation and still be the same column — Rainbow Six retitled
  // "Start Time" to "Start Time\nROLLING SCHEDULE", which silently took its whole schedule
  // to zero fixtures. Fall back to a leading-phrase match, but only for aliases that are
  // already several words: a one-word alias like "time" would otherwise claim "Time Zone".
  for (const alias of aliases) {
    if (!alias.includes(' ')) continue;
    const index = normalized.findIndex((header) => header.startsWith(`${alias} `));
    if (index >= 0) return index;
  }
  return -1;
}

function scheduleMatchHeaderIndex(row) {
  const exact = headerIndex(row, SCHEDULE_MATCH_HEADERS);
  if (exact >= 0) return exact;
  return row.map(normalizedHeader).findIndex((header) =>
    header.startsWith('match ') && !['match date', 'match day', 'match time', 'match status'].includes(header),
  );
}

// Some official sheets repeat a header label for a second block of columns — the
// Overwatch match log heads both its team columns and its ban-order columns "(A) Home"
// / "(B) Away". Resolve the later block by searching past the column that separates them.
function headerIndexAfter(row, aliases, afterIndex) {
  if (!(afterIndex >= 0)) return -1;
  const normalized = row.map(normalizedHeader);
  for (let index = afterIndex + 1; index < normalized.length; index += 1) {
    if (aliases.includes(normalized[index])) return index;
  }
  return -1;
}

function findHeader(rows, requiredGroups) {
  for (let index = 0; index < Math.min(rows.length, 80); index += 1) {
    const row = rows[index] || [];
    if (requiredGroups.every((aliases) => headerIndex(row, aliases) >= 0)) return { index, row };
  }
  return null;
}

function findScheduleHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 100); index += 1) {
    const row = rows[index] || [];
    const date = headerIndex(row, SCHEDULE_DATE_HEADERS);
    const time = headerIndex(row, SCHEDULE_TIME_HEADERS);
    const match = scheduleMatchHeaderIndex(row);
    const teamA = headerIndex(row, ['team a', 'player a', 'home player', 'home team', 'participant a']);
    const teamB = headerIndex(row, ['team b', 'player b', 'away player', 'away team', 'participant b']);
    if (date >= 0 && time >= 0 && (match >= 0 || (teamA >= 0 && teamB >= 0))) {
      return { index, row };
    }
  }
  return null;
}

function number(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(String(value).replaceAll(',', '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function googleDateParts(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const whole = Math.floor(value);
    const date = new Date(Date.UTC(1899, 11, 30) + whole * 86_400_000);
    return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
  }
  const raw = text(value);
  const match = raw.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3]);
  return first > 31 ? [first, second - 1, third] : [third < 100 ? 2000 + third : third, second - 1, first];
}

function secondsOfDay(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fraction = ((value % 1) + 1) % 1;
    return Math.round(fraction * 86_400);
  }
  const raw = text(value).toLowerCase();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (match[4] === 'pm' && hour < 12) hour += 12;
  if (match[4] === 'am' && hour === 12) hour = 0;
  return hour * 3600 + minute * 60 + second;
}

export function scheduleTimestamp(dateValue, timeValue, timezoneOffsetMinutes = 180) {
  const parts = googleDateParts(dateValue);
  const seconds = secondsOfDay(timeValue);
  if (!parts || seconds === null) return null;
  return Math.floor(
    (Date.UTC(parts[0], parts[1], parts[2]) + seconds * 1000 - timezoneOffsetMinutes * 60_000) /
      1000,
  );
}

// The official schedule's public Start Time column is commonly labeled CEST.
// Keep the parser's generic fallback at Riyadh time for legacy/unlabeled feeds,
// but honor an explicit workbook timezone before converting wall time to UTC.
function scheduleTimezoneOffsetMinutes(rows, header, timeIndex) {
  for (const row of rows.slice(header.index + 1, header.index + 8)) {
    const marker = text(row[timeIndex]).toUpperCase();
    if (/\bCEST\b/.test(marker)) return 120;
    if (/\bEEST\b/.test(marker)) return 180;
    if (/\b(?:CET|BST)\b/.test(marker)) return 60;
    if (/\b(?:UTC|GMT|WET)\b/.test(marker)) return 0;
  }
  return 180;
}

// The separator must be a standalone token, so it needs whitespace on BOTH sides —
// except "vs." where the dot already closes it and the sheets often omit the space
// ("Weibo Gaming vs.Twisted Minds"). Allowing a bare "v" to end at any character
// instead lets a team's own initial start the match: "CAG by VARREL vs Fnatic"
// splits three ways, is rejected, and the row degrades into a ghost fixture.
function splitPair(value) {
  const raw = text(value);
  const parts = raw.split(/\s+(?:vs\.\s*|vs?\s+)/i).map(text).filter(Boolean);
  return parts.length === 2 ? parts : null;
}

function stableExternalId({ game, round, name, teamA, teamB, scheduledAt }) {
  const logical = [game, round, name, normalizeTeamName(teamA), normalizeTeamName(teamB), scheduledAt || 'untimed']
    .join('|')
    .toLowerCase();
  return `official:${game}:${createHash('sha256').update(logical).digest('hex').slice(0, 24)}`;
}

export function parseSchedule(rows, { game }) {
  const found = findScheduleHeader(rows);
  if (!found) return [];
  const dateIndex = headerIndex(found.row, SCHEDULE_DATE_HEADERS);
  const timeIndex = headerIndex(found.row, SCHEDULE_TIME_HEADERS);
  const matchIndex = scheduleMatchHeaderIndex(found.row);
  const roundIndex = headerIndex(found.row, ['round', 'stage']);
  const bestOfIndex = headerIndex(found.row, ['best of x', 'best of', 'bo']);
  const teamAIndex = headerIndex(found.row, ['team a', 'player a', 'home player', 'home team']);
  const teamBIndex = headerIndex(found.row, ['team b', 'player b', 'away player', 'away team']);
  const scoreAIndex = headerIndex(found.row, ['score a', 'home score', 'team a score', 'player a score']);
  const scoreBIndex = headerIndex(found.row, ['score b', 'away score', 'team b score', 'player b score']);
  const statusIndex = headerIndex(found.row, ['status', 'match status']);
  const result = [];
  let activeDate = null;
  const timezoneOffsetMinutes = scheduleTimezoneOffsetMinutes(rows, found, timeIndex);

  for (const row of rows.slice(found.index + 1)) {
    const matchLabel = matchIndex >= 0 ? text(row[matchIndex]) : '';
    let teamA = teamAIndex >= 0 ? text(row[teamAIndex]) : '';
    let teamB = teamBIndex >= 0 ? text(row[teamBIndex]) : '';
    const pair = splitPair(matchLabel);
    if ((!teamA || !teamB) && pair) [teamA, teamB] = pair;
    if (googleDateParts(row[dateIndex])) activeDate = row[dateIndex];
    const scheduledAt = scheduleTimestamp(activeDate, row[timeIndex], timezoneOffsetMinutes);
    const round = roundIndex >= 0 ? text(row[roundIndex]) : '';
    const scoreA = scoreAIndex >= 0 ? number(row[scoreAIndex]) : null;
    const scoreB = scoreBIndex >= 0 ? number(row[scoreBIndex]) : null;
    const rawStatus = statusIndex >= 0 ? text(row[statusIndex]).toLowerCase() : '';
    if (!matchLabel && !teamA && !teamB) continue;
    if (!teamA || !teamB) {
      // A battle royale has no fixture to name, so its Match column carries the MAP —
      // "Rondo", "Erangel" — while the round says which game of which group it is. Taking
      // the map made every PUBG game read "Rondo vs Lobby". The round is the identity.
      teamA = isLobbyGame(game)
        ? round || matchLabel || 'Lobby'
        : matchLabel || round || 'Lobby';
      teamB = 'Lobby';
    }
    const name = matchLabel || `${teamA} vs ${teamB}`;
    result.push({
      source: null,
      externalId: stableExternalId({ game, round, name, teamA, teamB, scheduledAt }),
      name,
      teamA,
      teamB,
      scoreA,
      scoreB,
      status: scheduleStatus(rawStatus, scoreA, scoreB, bestOfIndex >= 0 ? number(row[bestOfIndex]) : null),
      scheduledAt,
      round,
      bestOf: bestOfIndex >= 0 ? number(row[bestOfIndex]) : null,
    });
  }
  return result.slice(0, 500);
}

function scheduleStatus(rawStatus, scoreA, scoreB, bestOf) {
  if (/live|running|in progress/.test(rawStatus)) return 'running';
  if (/complete|finished|final/.test(rawStatus)) return 'finished';
  if (scoreA === null || scoreB === null) return 'scheduled';

  // A score pair on a live series is often only the maps/games already played.
  // When the sheet exposes a best-of value, only a score that reaches the
  // winning threshold is terminal; otherwise keep the row running.
  const winsRequired = Number.isFinite(bestOf) && bestOf > 1 ? Math.floor(bestOf / 2) + 1 : null;
  if (winsRequired !== null) {
    return Math.max(scoreA, scoreB) >= winsRequired && scoreA !== scoreB ? 'finished' : 'running';
  }
  return 'finished';
}

// The Visualization tab draws the bracket rather than tabulating it: each match is a label
// row followed by its two teams, with the series score in the NEXT column over, and the
// round's best-of sitting on its own as a bare number above the block.
//
//   col 3          col 4
//   UB Ro8 …
//   5                        <- best-of for every match in this column
//   UB 1.1                   <- match label
//   FaZe Clan      3
//   The Pit        0
//
// Several brackets share the sheet side by side, so find the name columns by looking for
// the score beside them rather than assuming where they are.
export function parseBracketResults(rows) {
  const grid = rows || [];
  const width = Math.max(...grid.map((row) => (row || []).length), 0);
  const results = [];

  for (let column = 0; column + 1 < width; column += 1) {
    const scored = grid.some(
      (row) => text(row?.[column]) && Number.isFinite(number(row?.[column + 1])),
    );
    if (!scored) continue;

    let bestOf = null;
    let round = '';
    let pair = [];
    for (const row of grid) {
      const name = text(row?.[column]);
      const score = number(row?.[column + 1]);
      if (!name) {
        // A blank cell ends whatever block was being read; half a pair is not a match.
        pair = [];
        continue;
      }
      if (!Number.isFinite(score)) {
        // Text with no score beside it is a heading: a bare number is the best-of, and
        // anything else names the match the following rows belong to. Test the RAW cell,
        // because a label like "UB 1.1" parses loosely as the number 1.1 and would
        // otherwise replace a real best-of of 5.
        if (typeof row?.[column] === 'number') bestOf = row[column];
        else round = name;
        pair = [];
        continue;
      }
      pair.push({ name, score });
      if (pair.length < 2) continue;
      const [a, b] = pair;
      pair = [];
      // An undrawn slot carries no result, and 0-0 is how the bracket draws "not played".
      if (isBracketPlaceholder(a.name) || isBracketPlaceholder(b.name)) continue;
      if (a.score === 0 && b.score === 0) continue;
      // The tab also holds numeric tables — group rankings, points — whose rows look like a
      // name beside a number. A competitor's name always has a letter in it; "11 4-0 12" is
      // a row of a standings grid, not a series.
      if (!/[a-z]/i.test(a.name) || !/[a-z]/i.test(b.name)) continue;
      results.push({
        round,
        teamA: a.name,
        teamB: b.name,
        scoreA: a.score,
        scoreB: b.score,
        bestOf,
        status: scheduleStatus('', a.score, b.score, bestOf),
      });
    }
  }
  return results.slice(0, 500);
}

// The same drawn bracket, kept as a GRAPH rather than a list of results, so it can be
// drawn rather than tabulated. The tab already holds the geometry: a name column is a
// round, the slots run down it in order, and the headings above each slot name it.
//
// A column can carry more than one round — Rainbow Six stacks "UB Ro4" above
// "LB Semi-Final" in the same column — so a new heading starts a new group rather than a
// new column.
//
// Edges come from the sheet too: a later slot literally reads "Winner of UB 2.1", so the
// link is read, never inferred from bracket arithmetic.
const BRACKET_SOURCE = /^(winner|loser)\s+of\s+(.+)$/i;

function bracketKind(label) {
  const value = text(label);
  if (/grand\s*final/i.test(value)) return 'final';
  if (/^lb\b|lower/i.test(value)) return 'lower';
  if (/^ub\b|upper/i.test(value)) return 'upper';
  return 'other';
}

function bracketSource(name) {
  const match = text(name).match(BRACKET_SOURCE);
  if (!match) return null;
  return { outcome: match[1].toLowerCase(), slot: text(match[2]) };
}

// A position in the draw rather than a round that opens one: "UB 1.1", "LB 2.2 (loser
// out)", "Semi-Final 1", "Grand Final", "3rd place match".
function isBracketSlotLabel(value) {
  const label = text(value);
  return /\d+\.\d+/.test(label) || /^(?:semi[-\s]?final|grand\s*final|final|3rd\s*place)/i.test(label);
}

export function parseBracketStructure(rows) {
  const grid = rows || [];
  const width = Math.max(...grid.map((row) => (row || []).length), 0);
  const groups = [];
  const isNameColumn = (column) =>
    grid.some((row) => text(row?.[column]) && Number.isFinite(number(row?.[column + 1])));

  // "GROUPSTAGE", "Group A", "PLAYOFFS" — a heading that stands on its own away from the
  // slots, telling two identical-looking rounds apart. Black Ops 7 draws both of its
  // groups as "UB Ro8 (Quarter-finals)" in the same column.
  const markers = [];
  grid.forEach((row, rowIndex) => {
    (row || []).forEach((cell, column) => {
      const label = text(cell);
      if (!label || isNameColumn(column) || isNameColumn(column - 1)) return;
      markers.push({ row: rowIndex, column, label });
    });
  });
  // Nearest heading at or left of the round, preferring one that starts the same column
  // block over a page-wide title further left.
  const sectionFor = (column, row) => {
    const candidates = markers.filter((marker) => marker.column <= column && marker.row <= row);
    if (!candidates.length) return '';
    const nearestColumn = Math.max(...candidates.map((marker) => marker.column));
    const inColumn = candidates.filter((marker) => marker.column === nearestColumn);
    return inColumn[inColumn.length - 1].label;
  };

  for (let column = 0; column + 1 < width; column += 1) {
    if (!isNameColumn(column)) continue;

    let bestOf = null;
    let pendingSlot = '';
    let pair = [];
    let group = null;
    let rowIndex = -1;
    const startGroup = (heading) => {
      group = {
        column,
        section: sectionFor(column, rowIndex),
        title: heading,
        bracket: bracketKind(heading),
        bestOf,
        slots: [],
      };
      groups.push(group);
    };

    for (const row of grid) {
      rowIndex += 1;
      const name = text(row?.[column]);
      const score = number(row?.[column + 1]);
      if (!name) {
        pair = [];
        continue;
      }
      if (!Number.isFinite(score)) {
        if (typeof row?.[column] === 'number') bestOf = row[column];
        // A slot names a position in the draw — "UB 1.1", "Semi-Final 2", "Grand Final".
        // Anything else opens a round. Telling them apart by SHAPE rather than by order
        // matters because a round whose slots are undrawn consumes no slot label, and the
        // heading would otherwise leak onto the next block down the same column — which
        // filed Black Ops 7's Group B upper bracket under Group A's "LB Ro4a".
        else if (isBracketSlotLabel(name)) pendingSlot = name;
        else startGroup(name);
        pair = [];
        continue;
      }
      pair.push({ name, score });
      if (pair.length < 2) continue;
      const [a, b] = pair;
      pair = [];
      // Ranking grids share the tab and read as a name beside a number.
      if (!/[a-z]/i.test(a.name) || !/[a-z]/i.test(b.name)) {
        pendingSlot = '';
        continue;
      }
      const slotLabel = pendingSlot;
      pendingSlot = '';
      if (!group) startGroup('Bracket');
      group.bestOf = group.bestOf ?? bestOf;
      group.slots.push({
        label: slotLabel,
        bracket: bracketKind(slotLabel) === 'other' ? group.bracket : bracketKind(slotLabel),
        teamA: a.name,
        teamB: b.name,
        // 0-0 is how the bracket draws a slot that has not been played, so it carries no
        // score rather than a level one — the same reading parseBracketResults uses.
        scoreA: a.score === 0 && b.score === 0 ? null : a.score,
        scoreB: a.score === 0 && b.score === 0 ? null : b.score,
        status: a.score === 0 && b.score === 0
          ? 'scheduled'
          : scheduleStatus('', a.score, b.score, bestOf),
        sourceA: bracketSource(a.name),
        sourceB: bracketSource(b.name),
      });
      if (group.slots.length >= MAX_ENTRIES) break;
    }
  }
  return groups.filter((entry) => entry.slots.length).slice(0, MAX_SECTIONS);
}

function isBracketPlaceholder(value) {
  return /\b(?:winner|loser)\s+of\b|^(?:tbd|q)$/i.test(text(value));
}

export function parseIndividualResults(rows, { game }) {
  const found = findHeader(rows, [
    ['home player', 'player a', 'home'],
    ['away player', 'player b', 'away'],
    ['home goals', 'score a', 'home score'],
    ['away goals', 'score b', 'away score'],
  ]);
  if (!found) return [];
  const homeIndex = headerIndex(found.row, ['home player', 'player a', 'home']);
  const awayIndex = headerIndex(found.row, ['away player', 'player b', 'away']);
  const scoreAIndex = headerIndex(found.row, ['home goals', 'score a', 'home score']);
  const scoreBIndex = headerIndex(found.row, ['away goals', 'score b', 'away score']);
  const penaltyAIndex = headerIndex(found.row, ['pk score home', 'home penalties']);
  const penaltyBIndex = headerIndex(found.row, ['pk score away', 'away penalties']);
  const roundIndex = headerIndex(found.row, ['round and match', 'round', 'match']);
  const results = [];
  for (const row of rows.slice(found.index + 1)) {
    const teamA = text(row[homeIndex]);
    const teamB = text(row[awayIndex]);
    const scoreA = number(row[scoreAIndex]);
    const scoreB = number(row[scoreBIndex]);
    if (!teamA || !teamB || scoreA === null || scoreB === null) continue;
    const round = roundIndex >= 0 ? text(row[roundIndex]) : '';
    results.push({
      game,
      round,
      teamA,
      teamB,
      scoreA,
      scoreB,
      penaltyA: penaltyAIndex >= 0 ? number(row[penaltyAIndex]) : null,
      penaltyB: penaltyBIndex >= 0 ? number(row[penaltyBIndex]) : null,
    });
  }
  return results.slice(0, 500);
}

export function parseStandings(rows) {
  const sections = [];
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 1_100); rowIndex += 1) {
    const header = rows[rowIndex] || [];
    const rankIndex = headerIndex(header, ['rank', 'place', '#']);
    const teamIndex = headerIndex(header, ['team', 'participant', 'player', 'club']);
    const pointsIndex = headerIndex(header, ['points', 'total points', 'pts', 'score']);
    if (rankIndex < 0 || teamIndex < 0 || pointsIndex < 0) continue;
    const title = text(rows[rowIndex - 1]?.find((cell) => text(cell))) || 'Standings';
    const entries = [];
    const seenTeams = new Set();
    for (const row of rows.slice(rowIndex + 1, rowIndex + 1 + MAX_ENTRIES)) {
      const team = text(row[teamIndex]);
      const rank = number(row[rankIndex]);
      const points = text(row[pointsIndex]);
      if (!team && rank === null) break;
      if (!team || rank === null || rank < 1 || rank > 256 || !points) continue;
      const teamKey = normalizeTeamName(team);
      if (!teamKey || seenTeams.has(teamKey)) continue;
      seenTeams.add(teamKey);
      entries.push({
        rank: Math.max(0, Math.trunc(rank)),
        team,
        points,
        extra: '',
        logo: null,
      });
    }
    if (entries.length >= 2) {
      const signature = entries.map((entry) => `${entry.rank}:${normalizeTeamName(entry.team)}:${entry.points}`).join('|');
      if (!sections.some((section) => section.signature === signature)) {
        sections.push({ title, entries, signature });
      }
    }
    if (sections.length >= MAX_SECTIONS) break;
  }
  return sections.map(({ signature: _signature, ...section }) => section);
}

// A battle royale tabulates its stages SIDE BY SIDE on one tab — Group A, Group B, the
// Survival Stage and the Grand Finals share every row — and ranks its teams by a points
// breakdown rather than a single column:
//
//   Group Stage - Group A                        Group Stage - Group B
//   Team Name  WWCD  Place  Elims  Total  Played Team Name  WWCD  ...
// 1 FURIA         2     34     18     52      12 IDA Esports ...
//
// parseStandings reads one block per header row and wants a labelled rank column, so it
// finds none of this. Read each block from its own "Team Name" instead: the rank is the
// unlabelled number beside it and the stage title sits above it in the same column.
export function parseBattleRoyaleStandings(rows) {
  const sections = [];
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 400); rowIndex += 1) {
    const header = (rows[rowIndex] || []).map(normalizedHeader);
    for (let column = 0; column < header.length; column += 1) {
      if (header[column] !== 'team name') continue;
      // Everything up to the next block belongs to this one.
      const next = header.indexOf('team name', column + 1);
      const end = next < 0 ? header.length : next;
      const statIndex = (label) => {
        for (let index = column + 1; index < end; index += 1) if (header[index] === label) return index;
        return -1;
      };
      const totalIndex = statIndex('total');
      if (totalIndex < 0) continue;
      const wwcdIndex = statIndex('wwcd');
      const placeIndex = statIndex('place points');
      const elimIndex = statIndex('elimination points');
      const playedIndex = statIndex('played matches');
      const rankIndex = column - 1;
      if (rankIndex < 0) continue;

      // Walk up for the stage name, skipping the annotation rows that sit between it and
      // the header — "From game: 1", "Till game: 12" — whose labels end in a colon.
      let title = '';
      for (let above = rowIndex - 1; above >= 0 && !title; above -= 1) {
        for (let near = column; near >= Math.max(0, column - 2) && !title; near -= 1) {
          const candidate = text(rows[above]?.[near]);
          if (candidate && !candidate.endsWith(':')) title = candidate;
        }
      }

      const entries = [];
      const seen = new Set();
      for (const row of rows.slice(rowIndex + 1, rowIndex + 1 + MAX_ENTRIES)) {
        const team = text(row[column]);
        const rank = number(row[rankIndex]);
        if (!team && rank === null) break;
        if (!team || rank === null || rank < 1 || rank > 256) continue;
        const key = normalizeTeamName(team);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const stat = (index) => (index >= 0 ? number(row[index]) : null);
        const detail = [
          wwcdIndex >= 0 ? `WWCD ${stat(wwcdIndex) ?? 0}` : '',
          placeIndex >= 0 ? `${stat(placeIndex) ?? 0} placement` : '',
          elimIndex >= 0 ? `${stat(elimIndex) ?? 0} elims` : '',
          playedIndex >= 0 ? `${stat(playedIndex) ?? 0} played` : '',
        ].filter(Boolean).join(' · ');
        entries.push({
          rank: Math.max(0, Math.trunc(rank)),
          team,
          points: String(stat(totalIndex) ?? 0),
          extra: detail,
          logo: null,
        });
      }
      // A stage that has not been drawn yet lists no teams at all.
      if (entries.length >= 2) sections.push({ title: title || 'Standings', entries });
      if (sections.length >= MAX_SECTIONS) return sections;
    }
  }
  return sections;
}

export function parseTournamentOverview(rows) {
  const facts = [];
  const seen = new Set();
  for (const row of rows.slice(0, 600)) {
    for (let index = 0; index < row.length - 1; index += 1) {
      const label = publicOverviewText(row[index]);
      const value = publicOverviewText(row[index + 1]);
      if (!label || !value || label === value || label.length > 80 || value.length > 300) continue;
      const key = normalizedHeader(label);
      if (!PUBLIC_OVERVIEW_FACT_KEYS.has(key)) continue;
      const signature = `${key}\u0000${value.toLowerCase()}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      facts.push({ label, value });
      if (facts.length >= MAX_FACTS) return { facts };
    }
  }
  return { facts };
}

export function parseTournamentEnrichment(tabs) {
  return {
    ...parseTournamentOverview(tabs['Tournament Information'] || []),
    sections: [],
  };
}

const TEAM_A_HEADERS = ['team 1', 'home team', 'team a', 'a home'];
const TEAM_B_HEADERS = ['team 2', 'away team', 'team b', 'b away'];

export function parseTeamMapDetails(rows) {
  const found = findHeader(rows, [
    TEAM_A_HEADERS,
    TEAM_B_HEADERS,
    ['map', 'game', 'mapname', 'map name'],
  ]);
  if (!found) return [];
  const teamAIndex = headerIndex(found.row, TEAM_A_HEADERS);
  const teamBIndex = headerIndex(found.row, TEAM_B_HEADERS);
  const mapIndex = headerIndex(found.row, ['map', 'game', 'mapname', 'map name']);
  const scoreAIndex = headerIndex(found.row, ['team 1 score', 'home score', 'score a']);
  const scoreBIndex = headerIndex(found.row, ['team 2 score', 'away score', 'score b']);
  const winnerIndex = headerIndex(found.row, ['winner', 'map winner']);
  const roundIndex = headerIndex(found.row, ['round', 'match', 'series']);
  const modeIndex = headerIndex(found.row, ['mode', 'map mode', 'map type']);
  const pickedByIndex = headerIndex(found.row, ['pickedby', 'picked by', 'picked']);
  const banAIndex = headerIndex(found.row, ['home ban', 'team a ban', 'ban a']);
  const banBIndex = headerIndex(found.row, ['away ban', 'team b ban', 'ban b']);
  // Ban-order columns repeat the team header labels, so they only resolve after the bans.
  const banOrderAIndex = headerIndexAfter(found.row, TEAM_A_HEADERS, banBIndex);
  const banOrderBIndex = headerIndexAfter(found.row, TEAM_B_HEADERS, banBIndex);

  const details = [];
  // A series writes its teams once and leaves them blank on its later map rows, so carry
  // the pair forward until a new series or a new pair starts.
  let carriedRound = '';
  let carriedTeamA = '';
  let carriedTeamB = '';
  for (const row of rows.slice(found.index + 1)) {
    const round = roundIndex >= 0 ? text(row[roundIndex]) : '';
    if (round && round !== carriedRound) {
      carriedRound = round;
      carriedTeamA = '';
      carriedTeamB = '';
    }
    const teamA = text(row[teamAIndex]) || carriedTeamA;
    const teamB = text(row[teamBIndex]) || carriedTeamB;
    carriedTeamA = teamA;
    carriedTeamB = teamB;

    const map = text(row[mapIndex]);
    if (!teamA || !teamB || !map) continue;

    const banA = banAIndex >= 0 ? text(row[banAIndex]) : '';
    const banB = banBIndex >= 0 ? text(row[banBIndex]) : '';
    details.push({
      teamA,
      teamB,
      round: round || carriedRound,
      map,
      mode: modeIndex >= 0 ? text(row[modeIndex]) : '',
      pickedBy: pickedByIndex >= 0 ? text(row[pickedByIndex]) : '',
      scoreA: scoreAIndex >= 0 ? number(row[scoreAIndex]) : null,
      scoreB: scoreBIndex >= 0 ? number(row[scoreBIndex]) : null,
      winner: winnerIndex >= 0 ? text(row[winnerIndex]) : '',
      banA,
      banB,
      banOrderA: banA && banOrderAIndex >= 0 ? number(row[banOrderAIndex]) : null,
      banOrderB: banB && banOrderBIndex >= 0 ? number(row[banOrderBIndex]) : null,
    });
  }
  return details.slice(0, 1_000);
}

// Rainbow Six keeps its map veto in BO1_VETOS / BO3_VETOS / BO5_VETO, one row per series
// and one COLUMN per veto step, so a Bo5 row is 35 columns wide. The three layouts differ
// only in how many steps they hold, and every step names itself in the header, so walk the
// header left to right instead of pinning column numbers per format.
const VETO_STEP_ROLES = new Map([
  ['team a ban', { kind: 'ban', side: 'a' }],
  ['team b ban', { kind: 'ban', side: 'b' }],
  ['team a map pick', { kind: 'pick', side: 'a' }],
  ['team b map pick', { kind: 'pick', side: 'b' }],
  // Nobody picks a decider — it is whatever map the bans and picks leave behind — so it
  // has no team, and Bo3 gives it no side columns either. Mark it rather than leaving a
  // map that reads as though its picker went missing.
  ['final map', { kind: 'pick', side: null, decider: true }],
  ['decider', { kind: 'pick', side: null, decider: true }],
]);

// Side-choice columns are labelled with the team, not the header: "Fnatic OT Side Choice".
function vetoSideChoiceTeam(value) {
  return text(value).replace(/\s*(?:ot\s*)?side\s*choice\s*$/i, '').trim();
}

export function parseSeriesVetoes(rows) {
  const header = (rows || [])[0] || [];
  const normalizedRow = header.map(normalizedHeader);
  const teamAIndex = normalizedRow.indexOf('team a');
  const teamBIndex = normalizedRow.indexOf('team b');
  const matchIndex = normalizedRow.indexOf('match');
  if (teamAIndex < 0 || teamBIndex < 0) return [];
  const confirmedIndex = normalizedRow.indexOf('confirmed');

  // Steps in column order. A side pick attaches to the map picked immediately before it,
  // and the column just before it carries the team that made the choice.
  const steps = [];
  for (let index = 0; index < normalizedRow.length; index += 1) {
    const role = VETO_STEP_ROLES.get(normalizedRow[index]);
    if (role) {
      steps.push({ ...role, index });
      continue;
    }
    const overtime = normalizedRow[index] === 'ot side pick';
    if (!overtime && normalizedRow[index] !== 'side pick') continue;
    const target = [...steps].reverse().find((step) => step.kind === 'pick');
    if (!target) continue;
    target[overtime ? 'otSideIndex' : 'sideIndex'] = index;
    target[overtime ? 'otSideTeamIndex' : 'sideTeamIndex'] = index - 1;
  }
  if (!steps.length) return [];

  const series = [];
  for (const row of (rows || []).slice(1)) {
    const teamA = text(row[teamAIndex]);
    const teamB = text(row[teamBIndex]);
    if (!teamA || !teamB) continue;
    const sideFor = (side) => (side === 'a' ? teamA : side === 'b' ? teamB : '');

    const maps = [];
    const bans = [];
    // `order` counts within its own list — ban 1..n, map 1..n in play order — while `step`
    // is the position in the veto itself. Bo3 bans two more maps AFTER both picks, so the
    // two numbers genuinely differ and collapsing them would misreport the sequence.
    let step_ = 0;
    for (const step of steps) {
      const map = text(row[step.index]);
      if (!map) continue;
      step_ += 1;
      if (step.kind === 'ban') {
        bans.push({ map, team: sideFor(step.side), order: bans.length + 1, step: step_ });
        continue;
      }
      maps.push({
        map,
        order: maps.length + 1,
        step: step_,
        decider: Boolean(step.decider),
        pickedBy: sideFor(step.side),
        sidePick: step.sideIndex >= 0 ? text(row[step.sideIndex]) : '',
        sidePickTeam: step.sideTeamIndex >= 0 ? vetoSideChoiceTeam(row[step.sideTeamIndex]) : '',
        otSidePick: step.otSideIndex >= 0 ? text(row[step.otSideIndex]) : '',
        otSidePickTeam: step.otSideTeamIndex >= 0 ? vetoSideChoiceTeam(row[step.otSideTeamIndex]) : '',
      });
    }
    if (!maps.length && !bans.length) continue;

    series.push({
      teamA,
      teamB,
      round: matchIndex >= 0 ? text(row[matchIndex]) : '',
      confirmed: confirmedIndex >= 0 ? /^confirmed$/i.test(text(row[confirmedIndex])) : false,
      maps,
      bans,
    });
  }
  return series.slice(0, 500);
}

// The veto tabs describe the same thing the Overwatch match log does — which maps a series
// played, and who chose them — so flatten them into the shared map-detail shape rather than
// giving Rainbow Six its own persistence path. Scores stay null: the veto is agreed before
// the series is played and the sheet never fills results back in.
// Call of Duty publishes its veto TRANSPOSED relative to Rainbow Six: one COLUMN per
// series, one ROW per veto step, and the sheet stacks several grids (a 9-game one above a
// 7-game one) each introduced by its own "Team A" / "Team B" pair. Rows in between name
// the mode, and Call of Duty bans within EACH mode rather than once for the series, so a
// ban carries the mode it belongs to.
//
// Every step names itself, so read the labels rather than pinning row numbers — the same
// reason the Rainbow Six reader walks its header instead of counting columns.
const TRANSPOSED_STEPS = [
  { kind: 'ban', pattern: /^team (a|b) bans$/i },
  { kind: 'pick', pattern: /^team (a|b) picks game (\d+)$/i },
  { kind: 'decider', pattern: /^remaining map \(game (\d+)\)$/i },
  { kind: 'side', pattern: /^team (a|b) chooses sides for game (\d+)$/i },
];

function transposedStep(label) {
  for (const { kind, pattern } of TRANSPOSED_STEPS) {
    const match = label.match(pattern);
    if (!match) continue;
    const side = /^(a|b)$/i.test(match[1] ?? '') ? match[1].toLowerCase() : null;
    const game = Number(kind === 'decider' ? match[1] : match[2]);
    return { kind, side, game: Number.isFinite(game) ? game : null };
  }
  return null;
}

export function parseTransposedSeriesVetoes(rows) {
  const grid = rows || [];
  const label = (index) => text(grid[index]?.[0]);
  const blocks = [];
  for (let index = 0; index < grid.length; index += 1) {
    if (/^team a$/i.test(label(index)) && /^team b$/i.test(label(index + 1))) blocks.push(index);
  }
  if (!blocks.length) return [];

  // Identity rows sit above the first block with no label of their own: the matchup row is
  // the one naming both teams, and the round row is the other text row beside it.
  const identity = [];
  for (let index = 0; index < blocks[0]; index += 1) {
    if (!label(index) && (grid[index] || []).some((cell) => text(cell))) identity.push(index);
  }
  const matchupRow = identity.find((index) =>
    (grid[index] || []).some((cell) => splitPair(cell)),
  );
  const roundRow = identity.find(
    (index) => index !== matchupRow && (grid[index] || []).some((cell) => /[a-z]/i.test(text(cell))),
  );

  const series = [];
  for (let block = 0; block < blocks.length; block += 1) {
    const teamARow = blocks[block];
    const end = blocks[block + 1] ?? grid.length;
    const width = Math.max(...grid.slice(teamARow, end).map((row) => (row || []).length), 0);

    for (let column = 1; column < width; column += 1) {
      const teamA = text(grid[teamARow]?.[column]);
      const teamB = text(grid[teamARow + 1]?.[column]);
      if (!teamA || !teamB) continue;
      const sideFor = (side) => (side === 'a' ? teamA : side === 'b' ? teamB : '');

      const bans = [];
      const byGame = new Map();
      let mode = '';
      let step = 0;
      for (let row = teamARow + 2; row < end; row += 1) {
        const rowLabel = label(row);
        if (!rowLabel) continue;
        const parsed = transposedStep(rowLabel);
        if (!parsed) {
          mode = rowLabel;
          continue;
        }
        const value = text(grid[row]?.[column]);
        if (!value) continue;
        step += 1;
        if (parsed.kind === 'ban') {
          bans.push({ map: value, team: sideFor(parsed.side), mode, order: bans.length + 1, step });
          continue;
        }
        const game = byGame.get(parsed.game) || {
          map: '',
          mode: '',
          order: parsed.game,
          step,
          decider: false,
          pickedBy: '',
          sidePick: '',
          sidePickTeam: '',
          otSidePick: '',
          otSidePickTeam: '',
        };
        if (parsed.kind === 'side') {
          game.sidePick = value;
          game.sidePickTeam = sideFor(parsed.side);
        } else {
          game.map = value;
          game.mode = mode;
          game.step = step;
          game.decider = parsed.kind === 'decider';
          game.pickedBy = sideFor(parsed.side);
        }
        byGame.set(parsed.game, game);
      }

      // A side choice can be recorded before its map is; without a map there is nothing to show.
      const maps = [...byGame.values()].filter((game) => game.map).sort((a, b) => a.order - b.order);
      if (!maps.length && !bans.length) continue;
      series.push({
        teamA,
        teamB,
        round: roundRow == null ? '' : text(grid[roundRow]?.[column]),
        confirmed: true,
        maps,
        bans,
      });
    }
  }
  return series.slice(0, 500);
}

export function seriesVetoesToMapDetails(series) {
  const details = [];
  for (const entry of series || []) {
    for (const map of entry.maps) {
      details.push({
        teamA: entry.teamA,
        teamB: entry.teamB,
        round: entry.round,
        map: map.map,
        // Rainbow Six has no per-map mode; Call of Duty vetoes each mode separately.
        mode: map.mode || '',
        decider: map.decider,
        pickedBy: map.pickedBy,
        scoreA: null,
        scoreB: null,
        winner: '',
        banA: '',
        banB: '',
        banOrderA: null,
        banOrderB: null,
        sidePick: map.sidePick,
        sidePickTeam: map.sidePickTeam,
        otSidePick: map.otSidePick,
        otSidePickTeam: map.otSidePickTeam,
        mapBans: entry.bans,
      });
    }
  }
  return details;
}

export function parseBattleRoyaleGames(rows) {
  const games = new Map();
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 1_100); rowIndex += 1) {
    const header = rows[rowIndex] || [];
    const gameIndex = headerIndex(header, ['game', 'match', 'round']);
    const rankIndex = headerIndex(header, ['rank', 'place', 'placement', '#']);
    const teamIndex = headerIndex(header, ['team', 'participant', 'player', 'club']);
    const pointsIndex = headerIndex(header, ['points', 'total points', 'pts', 'score']);
    if (rankIndex < 0 || teamIndex < 0 || pointsIndex < 0) continue;
    const placementIndex = headerIndex(header, ['placement points', 'place points']);
    const eliminationIndex = headerIndex(header, ['elimination points', 'kill points', 'kills', 'eliminations']);
    const fallbackLabel = text(rows[rowIndex - 1]?.find((cell) => text(cell))) || 'Game';
    let accepted = 0;
    for (const row of rows.slice(rowIndex + 1, rowIndex + 1 + MAX_ENTRIES)) {
      const team = text(row[teamIndex]);
      const rank = number(row[rankIndex]);
      const totalPoints = number(row[pointsIndex]);
      if (!team && rank === null) break;
      if (!team || rank === null || rank < 1 || rank > 128 || totalPoints === null) continue;
      const label = (gameIndex >= 0 ? text(row[gameIndex]) : '') || fallbackLabel;
      const key = normalizedHeader(label) || `game ${games.size + 1}`;
      const game = games.get(key) || { label, standings: [], seen: new Set() };
      const teamKey = normalizeTeamName(team);
      if (!teamKey || game.seen.has(teamKey)) continue;
      game.seen.add(teamKey);
      game.standings.push({
        rank: Math.trunc(rank),
        team,
        placementPoints: placementIndex >= 0 ? number(row[placementIndex]) : null,
        eliminationPoints: eliminationIndex >= 0 ? number(row[eliminationIndex]) : null,
        totalPoints,
      });
      games.set(key, game);
      accepted += 1;
    }
    if (accepted >= 2) rowIndex += accepted;
  }
  return [...games.values()]
    .filter((game) => game.standings.length >= 2)
    .slice(0, 40)
    .map(({ seen: _seen, ...game }) => game);
}

export function parseOfficialWorkbook(title, tabs) {
  const descriptor = workbookDescriptor(title);
  if (!descriptor) return null;
  const schedule = parseSchedule(tabs.Schedule || [], descriptor);
  const individualResults = parseIndividualResults(tabs['Match Results'] || [], descriptor);
  const standings = [
    ...parseStandings(tabs.Visualization || []),
    ...parseStandings(tabs['League Table'] || []),
    ...parseBattleRoyaleStandings(tabs.Standings || []),
  ].filter(
    (section, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.entries.map((entry) => `${entry.rank}:${normalizeTeamName(entry.team)}:${entry.points}`).join('|') ===
          section.entries.map((entry) => `${entry.rank}:${normalizeTeamName(entry.team)}:${entry.points}`).join('|'),
      ) === index,
  );
  const bracketResults = parseBracketResults(tabs.Visualization || []);
  const bracket = parseBracketStructure(tabs.Visualization || []);
  const overview = parseTournamentEnrichment(tabs);
  const seriesVetoes = [
    ...parseSeriesVetoes(tabs.BO1_VETOS || []),
    ...parseSeriesVetoes(tabs.BO3_VETOS || []),
    ...parseSeriesVetoes(tabs.BO5_VETO || []),
    ...parseTransposedSeriesVetoes(tabs.FullMapvetos || []),
  ];
  const mapDetails = [
    ...parseTeamMapDetails(tabs['MATCH INFO MASTER'] || []),
    ...seriesVetoesToMapDetails(seriesVetoes),
  ];
  const battleRoyaleGames = [
    ...parseBattleRoyaleGames(tabs.Visualization || []),
    ...parseBattleRoyaleGames(tabs['Match Results'] || []),
  ];
  return {
    descriptor,
    schedule,
    individualResults,
    standings,
    overview,
    mapDetails,
    seriesVetoes,
    bracketResults,
    bracket,
    battleRoyaleGames,
  };
}

export const officialParserLimits = Object.freeze({
  maxCellLength: MAX_CELL_LENGTH,
  maxFacts: MAX_FACTS,
  maxSections: MAX_SECTIONS,
  maxEntries: MAX_ENTRIES,
});
