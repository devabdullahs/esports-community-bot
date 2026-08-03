import { createHash } from 'node:crypto';
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
  ['call of duty black ops 7', { game: 'callofduty', tournamentNeedle: 'black ops' }],
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
      teamA = matchLabel || round || 'Lobby';
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
  ].filter(
    (section, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.entries.map((entry) => `${entry.rank}:${normalizeTeamName(entry.team)}:${entry.points}`).join('|') ===
          section.entries.map((entry) => `${entry.rank}:${normalizeTeamName(entry.team)}:${entry.points}`).join('|'),
      ) === index,
  );
  const overview = parseTournamentEnrichment(tabs);
  const mapDetails = parseTeamMapDetails(tabs['MATCH INFO MASTER'] || []);
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
    battleRoyaleGames,
  };
}

export const officialParserLimits = Object.freeze({
  maxCellLength: MAX_CELL_LENGTH,
  maxFacts: MAX_FACTS,
  maxSections: MAX_SECTIONS,
  maxEntries: MAX_ENTRIES,
});
