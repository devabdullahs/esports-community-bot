import { normalizeTeamName } from './render.js';

const RIYADH_UTC_OFFSET = '+03:00';
const EWC_SCHEDULE_TIME_ZONE = 'Asia/Riyadh';

export const WEEKLY_TOP_THREE_SWEEP_BONUS = 300;
export const WEEKLY_ALL_GAME_WINNERS_BONUS = 300;
export const SEASON_EXACT_RANK_BONUS = 250;
export const EWC_SEASON_PREDICTION_OPEN_BEFORE_DAYS = 14;
export const EWC_SEASON_PREDICTION_CLOSE_BEFORE_HOURS = 8;

export const EWC_POINTS_BY_RANK = new Map([
  [1, 1000],
  [2, 750],
  [3, 500],
  [4, 300],
  [5, 200],
  [6, 150],
  [7, 100],
  [8, 50],
]);

const EWC_AWARDED_RANKS = [...EWC_POINTS_BY_RANK.keys()];
const EWC_AUTHORITATIVE_RESULT_KINDS = new Set([
  'club-points-prize-table',
  'prize-table',
  'final-standings-panel',
  'tracked-final-standings',
]);

export const EWC_2026_OFFICIAL_WEEKS = [
  ['week-1', 'Week 1', '2026-07-06', '2026-07-12'],
  ['week-2', 'Week 2', '2026-07-13', '2026-07-19'],
  ['week-3', 'Week 3', '2026-07-20', '2026-07-26'],
  ['week-4', 'Week 4', '2026-07-27', '2026-08-02'],
  ['week-5', 'Week 5', '2026-08-04', '2026-08-09'],
  ['week-6', 'Week 6', '2026-08-10', '2026-08-16'],
  ['week-7', 'Week 7', '2026-08-17', '2026-08-23'],
];

export const EWC_2026_OFFICIAL_EVENT_DATES = [
  { test: /\bvalorant\b/i, start: '2026-07-09', end: '2026-07-12' },
  { test: /\balgs\b|\bapex\b/i, start: '2026-07-07', end: '2026-07-11' },
  { test: /fatal fury/i, start: '2026-07-08', end: '2026-07-11' },
  { test: /dota\s*2/i, start: '2026-07-07', end: '2026-07-19' },
  { test: /women'?s international/i, start: '2026-07-14', end: '2026-07-18' },
  { test: /free fire/i, start: '2026-07-15', end: '2026-07-18' },
  { test: /league of legends/i, start: '2026-07-15', end: '2026-07-19' },
  { test: /teamfight tactics|\btft\b/i, start: '2026-07-21', end: '2026-07-25' },
  { test: /\bpubg\b(?! mobile)/i, start: '2026-07-21', end: '2026-07-26' },
  { test: /fc pro|ea sports fc/i, start: '2026-07-22', end: '2026-07-26' },
  { test: /mid season cup/i, start: '2026-07-22', end: '2026-08-01' },
  { test: /street fighter/i, start: '2026-07-29', end: '2026-08-01' },
  { test: /warzone|resurgence/i, start: '2026-07-30', end: '2026-08-02' },
  { test: /overwatch|owcs/i, start: '2026-07-29', end: '2026-08-02' },
  { test: /honor of kings|\bhok\b/i, start: '2026-07-30', end: '2026-08-08' },
  { test: /tekken/i, start: '2026-08-05', end: '2026-08-08' },
  { test: /black ops|call of duty(?!: warzone)|\bbo7\b/i, start: '2026-08-05', end: '2026-08-09' },
  { test: /pubg mobile/i, start: '2026-08-06', end: '2026-08-16' },
  { test: /rainbow six|\br6\b/i, start: '2026-08-04', end: '2026-08-15' },
  { test: /chess/i, start: '2026-08-11', end: '2026-08-15' },
  { test: /rocket league/i, start: '2026-08-12', end: '2026-08-16' },
  { test: /counter-strike|counter strike|\bcs2\b/i, start: '2026-08-19', end: '2026-08-23' },
  { test: /trackmania/i, start: '2026-08-19', end: '2026-08-22' },
  { test: /crossfire/i, start: '2026-08-18', end: '2026-08-22' },
  { test: /fortnite|reload elite/i, start: '2026-08-19', end: '2026-08-22' },
];

export function normalizeClubName(name) {
  return String(name ?? '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Liquipedia prize tables occasionally use a current division abbreviation
// while the prediction picker stores the club's public name. Keep these
// verified identities explicit so scoring never relies on fuzzy matching.
const EWC_CLUB_ALIAS_GROUPS = [
  ['ag.al', 'all gamers', 'all gamers global'],
  ['los', 'mibr.los', 'mibr los'],
];

const EWC_CLUB_ALIASES = new Map();
for (const group of EWC_CLUB_ALIAS_GROUPS) {
  const keys = [...new Set(group.flatMap((name) => {
    const base = normalizeClubName(name);
    return [base, base.replace(/^team\s+/, ''), normalizeTeamName(name)].filter(Boolean);
  }))];
  for (const key of keys) EWC_CLUB_ALIASES.set(key, keys);
}

export function clubNameKeys(name) {
  const base = normalizeClubName(name);
  const noTeamPrefix = base.replace(/^team\s+/, '');
  const compact = normalizeTeamName(name);
  const direct = [base, noTeamPrefix, compact].filter(Boolean);
  const aliases = direct.flatMap((key) => EWC_CLUB_ALIASES.get(key) || []);
  return [...new Set([...direct, ...aliases])];
}

export function uniqueClubPicks(picks, requiredCount) {
  const clean = picks.map((pick) => String(pick ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const pick of clean) {
    const keys = clubNameKeys(pick);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    out.push(pick);
  }
  if (requiredCount && out.length !== requiredCount) {
    throw new Error(`Please choose ${requiredCount} different clubs.`);
  }
  return out;
}

export function ewcPlacementPoints(place) {
  const text = String(place ?? '').trim();
  const firstRank = Number(text.match(/\d+/)?.[0]);
  return EWC_POINTS_BY_RANK.get(firstRank) || 0;
}

export function ewcPlacementCoveredRanks(place) {
  const text = String(place ?? '').trim();
  const match = text.match(/^(\d+)(?:st|nd|rd|th)?\s*(?:-|\u2013|\u2014|to)?\s*(\d+)?(?:st|nd|rd|th)?$/i);
  if (!match) return [];
  const first = Number(match[1]);
  const last = Number(match[2] || match[1]);
  if (!EWC_POINTS_BY_RANK.has(first) || !EWC_POINTS_BY_RANK.has(last) || last < first) return [];
  return EWC_AWARDED_RANKS.filter((rank) => rank >= first && rank <= last);
}

function resultEvidenceCoveredRanks(evidence) {
  return new Set(
    (Array.isArray(evidence?.coveredRanks) ? evidence.coveredRanks : [])
      .map(Number)
      .filter((rank) => EWC_POINTS_BY_RANK.has(rank)),
  );
}

function completenessResult(ready, reason, coveredRanks) {
  return { ready, reason, coveredRanks: [...coveredRanks].sort((a, b) => a - b) };
}

export function evaluateEwcGameResultCompleteness(result = {}) {
  const evidence = result?.evidence;
  if (!evidence?.authoritative || !EWC_AUTHORITATIVE_RESULT_KINDS.has(evidence.kind)) {
    return completenessResult(false, 'untrusted_source', []);
  }

  const evidenceCoverage = resultEvidenceCoveredRanks(evidence);
  const placementCoverage = new Set();
  const champions = new Set();
  for (const row of Array.isArray(result?.placements) ? result.placements : []) {
    const ranks = ewcPlacementCoveredRanks(row?.place);
    if (!ranks.length) continue;
    const club = normalizeClubName(row?.club);
    if (!club) return completenessResult(false, 'invalid_club', placementCoverage);
    for (const rank of ranks) placementCoverage.add(rank);
    if (ranks.includes(1)) champions.add(club);
  }

  if (champions.size !== 1) return completenessResult(false, 'multiple_champions', placementCoverage);
  const missing = EWC_AWARDED_RANKS.filter((rank) => !evidenceCoverage.has(rank) || !placementCoverage.has(rank));
  if (missing.length) return completenessResult(false, 'missing_rank', placementCoverage);
  return completenessResult(true, 'ready', placementCoverage);
}

export function ewcGameResultPending(result) {
  const placements = result?.placements || [];
  if (!placements.length) return true;
  return !placements.some((row) => Number(row.points) === EWC_POINTS_BY_RANK.get(1) && row.club);
}

export function pendingEwcGameResults(results, games = []) {
  const byKey = new Map((results || []).map((result) => [result?.gameKey, result]));
  const expected = (games || []).length
    ? games.map((game) => byKey.get(game.key) || { gameKey: game.key, game: game.game, event: game.event, placements: [] })
    : results || [];
  return expected.filter((result) => !evaluateEwcGameResultCompleteness(result).ready);
}

export function perGamePredictionRoundLocked(games = [], now = Math.floor(Date.now() / 1000)) {
  if (!games.length) return false;
  return games.every((game) => {
    const lockAt = Number(game?.lockAt);
    return Number.isFinite(lockAt) && now >= lockAt;
  });
}

export function dueEwcGamesForResults(
  games = [],
  results = [],
  now = Math.floor(Date.now() / 1000),
  earlyWindowSec = 12 * 3600,
  scoreAfter = null,
) {
  const byKey = new Map((results || []).map((result) => [String(result?.gameKey || ''), result]));
  return (games || []).filter((game) => {
    const key = String(game?.key || '');
    if (!key) return false;
    const endAt = Number(game?.endAt);
    if (!Number.isFinite(endAt) || now < endAt - Math.max(0, Number(earlyWindowSec) || 0)) return false;
    const result = byKey.get(key);
    if (!evaluateEwcGameResultCompleteness(result).ready) return true;

    // Live battle-royale standings already contain a first-place row. A good
    // snapshot taken before the scheduled finish must therefore be refreshed
    // once after the event ends instead of being mistaken for a final result.
    const fetchedAt = Number(result?.fetchedAt) || 0;
    if (now >= endAt && fetchedAt < endAt) return true;
    const delayedFinalAt = Number(scoreAfter) || 0;
    return delayedFinalAt > endAt && now >= delayedFinalAt && fetchedAt < delayedFinalAt;
  });
}

export function ewcGameResultsFinalReady(results = [], games = [], now = Math.floor(Date.now() / 1000), scoreAfter = null) {
  return evaluateEwcGameResultsFinalReadiness(results, games, now, scoreAfter).ready;
}

export function evaluateEwcGameResultsFinalReadiness(results = [], games = [], now = Math.floor(Date.now() / 1000), scoreAfter = null) {
  const byKey = new Map((results || []).map((result) => [String(result?.gameKey || ''), result]));
  if (!(games || []).length) return { ready: false, reason: 'missing_rank', gameKey: null };
  for (const game of games || []) {
    const result = byKey.get(String(game?.key || ''));
    const completeness = evaluateEwcGameResultCompleteness(result);
    if (!completeness.ready) return { ...completeness, gameKey: String(game?.key || '') };
    const endAt = Number(game?.endAt) || 0;
    const finalAt = Math.max(endAt, Number(scoreAfter) || 0);
    if (now < finalAt || (Number(result?.fetchedAt) || 0) < finalAt) {
      return { ready: false, reason: 'stale', coveredRanks: completeness.coveredRanks, gameKey: String(game?.key || '') };
    }
  }
  return { ready: true, reason: 'ready', coveredRanks: EWC_AWARDED_RANKS, gameKey: null };
}

function resultSnapshotQuality(result) {
  const completeness = evaluateEwcGameResultCompleteness(result);
  const evidence = result?.evidence;
  const authoritative = Boolean(
    evidence?.authoritative && EWC_AUTHORITATIVE_RESULT_KINDS.has(evidence.kind),
  );
  const placementCoverage = new Set(
    (Array.isArray(result?.placements) ? result.placements : [])
      .flatMap((placement) => ewcPlacementCoveredRanks(placement?.place)),
  );
  return [
    completeness.ready ? 1 : 0,
    authoritative ? 1 : 0,
    placementCoverage.size,
    ewcGameResultPending(result) ? 0 : 1,
    Array.isArray(result?.placements) ? result.placements.length : 0,
    Number(result?.fetchedAt) || 0,
  ];
}

function incomingSnapshotIsBetter(current, incoming) {
  if (!current) return true;
  const currentQuality = resultSnapshotQuality(current);
  const incomingQuality = resultSnapshotQuality(incoming);
  for (let index = 0; index < currentQuality.length; index += 1) {
    if (incomingQuality[index] !== currentQuality[index]) {
      return incomingQuality[index] > currentQuality[index];
    }
  }
  return true;
}

export function mergeEwcGameResults(existing = [], incoming = []) {
  const merged = new Map();
  for (const result of existing || []) {
    const key = String(result?.gameKey || '');
    if (key) merged.set(key, result);
  }
  for (const result of incoming || []) {
    const key = String(result?.gameKey || '');
    if (!key) continue;
    const current = merged.get(key);
    if (incomingSnapshotIsBetter(current, result)) merged.set(key, result);
  }
  return [...merged.values()];
}

export function parsePredictionDate(input) {
  const value = String(input ?? '').trim();
  if (!value) return null;
  const discord = value.match(/<t:(\d+)(?::[tTdDfFR])?>/);
  if (discord) return Number(discord[1]);
  if (/^\d{10}$/.test(value)) return Number(value);
  if (/^\d{13}$/.test(value)) return Math.floor(Number(value) / 1000);

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}${RIYADH_UTC_OFFSET}`;
  const time = Date.parse(withZone);
  if (Number.isNaN(time)) throw new Error('Use a Discord timestamp, Unix seconds, or `YYYY-MM-DD HH:mm` Riyadh time.');
  return Math.floor(time / 1000);
}

function standingsMap(standings) {
  const map = new Map();
  for (const row of standings || []) {
    const value = {
      team: row.team,
      rank: Number(row.rank) || null,
      points: Number(row.points) || 0,
    };
    for (const key of clubNameKeys(row.team)) {
      if (!map.has(key)) map.set(key, value);
    }
  }
  return map;
}

export function weeklyPointDeltas(baseline, final) {
  const before = standingsMap(baseline);
  const rows = [];
  for (const row of final || []) {
    const team = row.team;
    const start = clubNameKeys(team).map((key) => before.get(key)?.points).find((points) => points != null) || 0;
    const points = Number(row.points) || 0;
    const delta = points - start;
    if (delta <= 0) continue;
    rows.push({
      team,
      rank: 0,
      weeklyPoints: delta,
      finalRank: Number(row.rank) || null,
      finalPoints: points,
      baselinePoints: start,
    });
  }
  rows.sort((a, b) => b.weeklyPoints - a.weeklyPoints || (a.finalRank || 9999) - (b.finalRank || 9999));
  let rank = 0;
  let previousPoints = null;
  rows.forEach((row, index) => {
    if (previousPoints !== row.weeklyPoints) rank = index + 1;
    row.rank = rank;
    previousPoints = row.weeklyPoints;
  });
  return rows;
}

export function scoreWeeklyPrediction(picks, baseline, final) {
  const cleanPicks = uniqueClubPicks(picks, 3);
  const deltas = weeklyPointDeltas(baseline, final);
  const byTeam = new Map();
  for (const row of deltas) {
    for (const key of clubNameKeys(row.team)) {
      if (!byTeam.has(key)) byTeam.set(key, row);
    }
  }
  const topThree = new Set(deltas.filter((row) => row.rank <= 3).flatMap((row) => clubNameKeys(row.team)));
  const pickDetails = cleanPicks.map((pick) => {
    const actual = clubNameKeys(pick).map((key) => byTeam.get(key)).find(Boolean);
    return {
      pick,
      matchedTeam: actual?.team || null,
      rank: actual?.rank || null,
      weeklyPoints: actual?.weeklyPoints || 0,
    };
  });
  const allTopThree = pickDetails.every((detail) => clubNameKeys(detail.matchedTeam || detail.pick).some((key) => topThree.has(key)));
  const bonus = allTopThree ? WEEKLY_TOP_THREE_SWEEP_BONUS : 0;
  return {
    score: pickDetails.reduce((sum, detail) => sum + detail.weeklyPoints, 0) + bonus,
    details: {
      picks: pickDetails,
      bonus,
      topThree: deltas.filter((row) => row.rank <= 3).map((row) => row.team),
      weeklyTopTen: deltas.slice(0, 10),
    },
  };
}

function normalizeGamePicks(picks) {
  if (!Array.isArray(picks)) return [];
  return picks
    .filter((pick) => pick && typeof pick === 'object' && pick.gameKey && pick.pick)
    .map((pick) => ({
      gameKey: String(pick.gameKey),
      game: pick.game || null,
      event: pick.event || null,
      pick: String(pick.pick).replace(/\s+/g, ' ').trim(),
      pickedAt: Number.isSafeInteger(Number(pick.pickedAt)) ? Number(pick.pickedAt) : null,
    }))
    .filter((pick) => pick.pick);
}

function resultMapForGame(results, gameKey) {
  const gameResult = (results || []).find((result) => result?.gameKey === gameKey);
  const map = new Map();
  for (const row of gameResult?.placements || []) {
    const value = {
      club: row.club,
      points: Number(row.points) || 0,
      place: row.place || null,
      participant: row.participant || null,
    };
    for (const key of clubNameKeys(row.club)) {
      if (!map.has(key)) map.set(key, value);
    }
    for (const key of clubNameKeys(row.participant)) {
      if (!map.has(key)) map.set(key, value);
    }
  }
  return { gameResult, map };
}

export function scorePerGameWeeklyPrediction(picks, games, results) {
  const cleanPicks = normalizeGamePicks(picks);
  const byGame = new Map(cleanPicks.map((pick) => [pick.gameKey, pick]));
  const activeGames = (games || []).filter((game) => game?.key);
  if (!activeGames.length) throw new Error('This weekly round has no per-game events configured.');

  const details = activeGames.map((game) => {
    const pick = byGame.get(game.key);
    const { gameResult, map } = resultMapForGame(results, game.key);
    const late = Boolean(pick?.pickedAt && game.lockAt && pick.pickedAt >= game.lockAt);
    const actual = pick && !late ? clubNameKeys(pick.pick).map((key) => map.get(key)).find(Boolean) : null;
    return {
      gameKey: game.key,
      game: game.game,
      event: game.event,
      pick: pick?.pick || null,
      matchedClub: actual?.club || null,
      place: actual?.place || null,
      participant: actual?.participant || null,
      points: actual?.points || 0,
      winner: (gameResult?.placements || []).find((row) => Number(row.points) === 1000)?.club || null,
      resultAvailable: Boolean(gameResult?.placements?.length),
      late,
    };
  });

  const complete = details.every((detail) => detail.pick && detail.resultAvailable);
  const allWinners = details.length > 1 && complete && details.every((detail) => detail.points === 1000);
  const bonus = allWinners ? WEEKLY_ALL_GAME_WINNERS_BONUS : 0;
  return {
    score: details.reduce((sum, detail) => sum + detail.points, 0) + bonus,
    details: {
      mode: 'per-game',
      picks: details,
      bonus,
      allWinners,
    },
  };
}

export function scoreSeasonPrediction(picks, finalStandings, topSize = 10) {
  const cleanPicks = uniqueClubPicks(picks);
  const finalTop = (finalStandings || []).filter((row, index) => (Number(row.rank) || index + 1) <= topSize);
  const byTeam = new Map();
  finalTop.forEach((row, index) => {
    const value = { ...row, actualIndex: index, actualRankNumber: Number(row.rank) || index + 1 };
    for (const key of clubNameKeys(row.team)) {
      if (!byTeam.has(key)) byTeam.set(key, value);
    }
  });
  const pickDetails = cleanPicks.slice(0, topSize).map((pick, predictedIndex) => {
    const actual = clubNameKeys(pick).map((key) => byTeam.get(key)).find(Boolean);
    if (!actual) return { pick, matchedTeam: null, actualRank: null, predictedRank: predictedIndex + 1, points: 0 };
    const hitPoints = Math.max(1, topSize - actual.actualRankNumber + 1) * 100;
    const exactBonus = actual.actualRankNumber === predictedIndex + 1 ? SEASON_EXACT_RANK_BONUS : 0;
    return {
      pick,
      matchedTeam: actual.team,
      actualRank: actual.actualRankNumber,
      predictedRank: predictedIndex + 1,
      hitPoints,
      exactBonus,
      points: hitPoints + exactBonus,
    };
  });
  return {
    score: pickDetails.reduce((sum, detail) => sum + detail.points, 0),
    details: {
      picks: pickDetails,
      finalTop: finalTop.map((row) => ({ rank: row.rank, team: row.team, points: row.points })),
    },
  };
}

export function formatTimestamp(seconds) {
  return seconds ? `<t:${seconds}:f> (<t:${seconds}:R>)` : 'Not set';
}

export function formatShortDate(seconds) {
  if (!seconds) return 'TBD';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(seconds * 1000));
}

function formatEwcShortDate(seconds) {
  if (!seconds) return 'TBD';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: EWC_SCHEDULE_TIME_ZONE,
  }).format(new Date(seconds * 1000));
}

function timeZoneOffsetMs(date, timeZone) {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (!value || value === 'GMT') return 0;
  const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]) || 0;
  const minutes = Number(match[3]) || 0;
  return sign * (hours * 60 + minutes) * 60_000;
}

export function officialEwcDateBoundary(dateText, endOfDay = false) {
  const [year, month, day] = String(dateText).split('-').map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const seconds = Math.floor((utcGuess.getTime() - timeZoneOffsetMs(utcGuess, EWC_SCHEDULE_TIME_ZONE)) / 1000);
  return endOfDay ? seconds + 24 * 3600 - 1 : seconds;
}

export function defaultEwcSeasonPredictionWindow(
  season = '2026',
  {
    openBeforeDays = EWC_SEASON_PREDICTION_OPEN_BEFORE_DAYS,
    closeBeforeHours = EWC_SEASON_PREDICTION_CLOSE_BEFORE_HOURS,
    scoreDelayHours = 24,
  } = {},
) {
  if (String(season) !== '2026') return null;
  const starts = EWC_2026_OFFICIAL_EVENT_DATES.map((event) => officialEwcDateBoundary(event.start));
  const ends = EWC_2026_OFFICIAL_EVENT_DATES.map((event) => officialEwcDateBoundary(event.end, true));
  const firstEventAt = Math.min(...starts);
  const finalEventEndAt = Math.max(...ends);
  return {
    firstEventAt,
    finalEventEndAt,
    openAt: firstEventAt - Math.max(0, Number(openBeforeDays) || 0) * 24 * 3600,
    closeAt: firstEventAt - Math.max(0, Number(closeBeforeHours) || 0) * 3600,
    scoreAfter: finalEventEndAt + Math.max(0, Number(scoreDelayHours) || 0) * 3600,
    openBeforeDays,
    closeBeforeHours,
    scoreDelayHours,
  };
}

export function effectiveEwcWeekStatus(round, now = Math.floor(Date.now() / 1000)) {
  if (!round) return { label: 'missing', lockedGames: 0, openGames: 0, totalGames: 0 };
  const games = Array.isArray(round.games) ? round.games : [];
  const totalGames = games.length;
  const lockedGames = games.filter((game) => game.lockAt && now >= game.lockAt).length;
  const openGames = totalGames ? totalGames - lockedGames : 0;

  if (round.status === 'scored') return { label: 'scored', lockedGames, openGames: 0, totalGames };
  if (round.status !== 'open') return { label: round.status, lockedGames, openGames: 0, totalGames };
  if (round.open_at && now < round.open_at) return { label: 'opens', at: round.open_at, lockedGames, openGames: 0, totalGames };
  if (totalGames) {
    if (lockedGames >= totalGames) return { label: 'locked', lockedGames, openGames: 0, totalGames };
    if (lockedGames > 0) return { label: 'partly open', lockedGames, openGames, totalGames };
    return { label: 'open', lockedGames, openGames, totalGames };
  }
  if (round.close_at && now >= round.close_at) return { label: 'closed', lockedGames, openGames: 0, totalGames };
  return { label: 'open', lockedGames, openGames, totalGames };
}

export function effectiveEwcWeekStatusText(round, now = Math.floor(Date.now() / 1000)) {
  const state = effectiveEwcWeekStatus(round, now);
  if (state.label === 'opens') return `opens ${formatTimestamp(state.at)}`;
  if (state.label === 'partly open') return `open (${state.openGames}/${state.totalGames} games left)`;
  if (state.label === 'locked') return 'locked';
  return state.label;
}

function applyOfficialEwc2026EventDates(event) {
  const [override] = matchingOfficialEwc2026EventDates(event);
  if (!override) return event;
  return {
    ...event,
    startAt: officialEwcDateBoundary(override.start),
    endAt: officialEwcDateBoundary(override.end, true),
    dateLabel: `${override.start} - ${override.end}`,
  };
}

function matchingOfficialEwc2026EventDates(event) {
  const hay = `${event?.game || ''} ${event?.event || ''}`;
  return EWC_2026_OFFICIAL_EVENT_DATES.filter((rule) => rule.test.test(hay));
}

function slugifyGameKey(value) {
  return String(value || 'event')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'event';
}

function officialWeekWindows2026() {
  return EWC_2026_OFFICIAL_WEEKS.map(([weekKey, name, start, end], index) => {
    const startAt = officialEwcDateBoundary(start);
    const endAt = officialEwcDateBoundary(end, true);
    return {
      index: index + 1,
      weekKey,
      name,
      startAt,
      endAt,
      label: `${name} (${formatEwcShortDate(startAt)} - ${formatEwcShortDate(endAt)})`,
    };
  });
}

function weekForEventEnd(event, windows) {
  return windows.find((week) => event.endAt >= week.startAt && event.endAt <= week.endAt) || null;
}

function compactEvent(event, index, lockBeforeHours) {
  const keyBase = slugifyGameKey(event.game || event.event || event.gameWiki || `event-${index + 1}`);
  return {
    key: `${keyBase}-${index + 1}`,
    game: event.game,
    gameWiki: event.gameWiki || null,
    event: event.event,
    eventUrl: event.eventUrl || null,
    startAt: event.startAt,
    endAt: event.endAt,
    lockAt: event.startAt ? event.startAt - lockBeforeHours * 3600 : null,
    dateLabel: event.dateLabel || null,
  };
}

const EWC_WEEK_TIMING_FIELDS = [
  ['startAt', 'start_at'],
  ['endAt', 'end_at'],
  ['openAt', 'open_at'],
  ['closeAt', 'close_at'],
  ['scoreAfter', 'score_after'],
];

function unixSeconds(value) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

function shiftedTime(value, oldReference, newReference) {
  const seconds = unixSeconds(value);
  return seconds == null ? null : newReference + (seconds - oldReference);
}

function changedFields(fields) {
  return fields.filter((field) => field.oldValue !== field.newValue);
}

export function reconcileStoredEwc2026Week(week) {
  if (String(week?.season) !== '2026') {
    throw new Error('Only stored EWC 2026 weeks can be reconciled.');
  }

  const officialWeek = officialWeekWindows2026().find((candidate) => candidate.weekKey === (week.week_key ?? week.weekKey));
  if (!officialWeek) {
    throw new Error('Stored EWC 2026 week cannot be matched to an official week.');
  }

  const storedGames = Array.isArray(week.games) ? week.games : [];
  if (!storedGames.length) {
    throw new Error('Stored EWC 2026 week has no event metadata to reconcile.');
  }

  const correctedGames = storedGames.map((game) => {
    const matches = matchingOfficialEwc2026EventDates(game);
    if (matches.length !== 1) {
      throw new Error('Stored EWC 2026 event cannot be uniquely matched to an official override.');
    }

    const oldStartAt = unixSeconds(game.startAt);
    const oldEndAt = unixSeconds(game.endAt);
    const oldLockAt = unixSeconds(game.lockAt);
    if (oldStartAt == null || oldEndAt == null || oldLockAt == null) {
      throw new Error('Stored EWC 2026 event is missing a timing value required for reconciliation.');
    }

    const override = matches[0];
    const startAt = officialEwcDateBoundary(override.start);
    const endAt = officialEwcDateBoundary(override.end, true);
    const lockAt = startAt + (oldLockAt - oldStartAt);
    return {
      ...game,
      startAt,
      endAt,
      lockAt,
      _reconciliation: { oldStartAt, oldEndAt, oldLockAt },
    };
  });

  const oldFirstLock = Math.min(...correctedGames.map((game) => game._reconciliation.oldLockAt));
  const newFirstLock = Math.min(...correctedGames.map((game) => game.lockAt));
  const oldLastLock = Math.max(...correctedGames.map((game) => game._reconciliation.oldLockAt));
  const newLastLock = Math.max(...correctedGames.map((game) => game.lockAt));
  const oldLastEnd = Math.max(...correctedGames.map((game) => game._reconciliation.oldEndAt));
  const newLastEnd = Math.max(...correctedGames.map((game) => game.endAt));
  const correctedTiming = {
    startAt: officialWeek.startAt,
    endAt: officialWeek.endAt,
    openAt: shiftedTime(week.open_at ?? week.openAt, oldFirstLock, newFirstLock),
    closeAt: shiftedTime(week.close_at ?? week.closeAt, oldLastLock, newLastLock),
    scoreAfter: shiftedTime(week.score_after ?? week.scoreAfter, oldLastEnd, newLastEnd),
  };

  const corrected = {
    ...correctedTiming,
    games: correctedGames.map(({ _reconciliation, ...game }) => game),
  };
  const weekDiff = changedFields(
    EWC_WEEK_TIMING_FIELDS.map(([key, column]) => ({
      field: column,
      oldValue: unixSeconds(week[column] ?? week[key]),
      newValue: correctedTiming[key],
    })),
  );
  const gameDiff = correctedGames
    .map((game, index) => ({
      gameKey: game.key ?? null,
      fields: changedFields([
        { field: 'startAt', oldValue: game._reconciliation.oldStartAt, newValue: game.startAt },
        { field: 'endAt', oldValue: game._reconciliation.oldEndAt, newValue: game.endAt },
        { field: 'lockAt', oldValue: game._reconciliation.oldLockAt, newValue: game.lockAt },
      ]),
      index,
    }))
    .filter((game) => game.fields.length);
  const invalidSubmissionIntervals = correctedGames
    .filter((game) => game.lockAt < game._reconciliation.oldLockAt)
    .map((game) => ({
      gameKey: game.key ?? null,
      newLockAt: game.lockAt,
      oldLockAt: game._reconciliation.oldLockAt,
    }));

  return {
    corrected,
    diff: { week: weekDiff, games: gameDiff },
    invalidSubmissionIntervals,
  };
}

export function generateEwcWeekWindows(events, { openBeforeHours = 48, lockBeforeHours = 24, scoreDelayHours = 24 } = {}) {
  const normalizedEvents = (events || []).map(applyOfficialEwc2026EventDates);
  const dated = normalizedEvents.filter((event) => event.startAt && event.endAt).sort((a, b) => a.startAt - b.startAt);
  if (!dated.length) return [];

  lockBeforeHours = Math.max(0, Number(lockBeforeHours) || 0);
  const year = new Date(dated[0].startAt * 1000).toLocaleString('en-GB', { timeZone: EWC_SCHEDULE_TIME_ZONE, year: 'numeric' });
  if (year === '2026') {
    const windows = officialWeekWindows2026();
    const byWeek = windows.map((week) => ({ ...week, events: [] }));
    dated.forEach((event, eventIndex) => {
      const week = weekForEventEnd(event, byWeek);
      if (!week) return;
      week.events.push(compactEvent(event, eventIndex, lockBeforeHours));
    });
    return byWeek
      .filter((week) => week.events.length)
      .map((week) => {
        const locks = week.events.map((event) => event.lockAt).filter(Boolean);
        const ends = week.events.map((event) => event.endAt).filter(Boolean);
        const firstLock = Math.min(...locks);
        const lastLock = Math.max(...locks);
        const lastEnd = Math.max(...ends);
        return {
          weekKey: week.weekKey,
          label: week.label,
          openAt: firstLock - openBeforeHours * 3600,
          closeAt: lastLock,
          scoreAfter: lastEnd + scoreDelayHours * 3600,
          startAt: week.startAt,
          endAt: week.endAt,
          events: week.events,
        };
      });
  }

  const firstStart = dated[0].startAt;
  const lastEnd = Math.max(...dated.map((event) => event.endAt));
  const weekSeconds = 7 * 24 * 3600;
  const weeks = [];
  let start = firstStart;
  let index = 1;
  while (start <= lastEnd) {
    const end = start + weekSeconds - 1;
    const weekEvents = dated
      .filter((event) => event.startAt <= end && event.endAt >= start)
      .map((event, eventIndex) => compactEvent(event, eventIndex, lockBeforeHours));
    if (weekEvents.length) {
      weeks.push({
        weekKey: `week-${index}`,
        label: `Week ${index} (${formatShortDate(start)} - ${formatShortDate(end)})`,
        openAt: start - openBeforeHours * 3600,
        closeAt: start,
        scoreAfter: end + scoreDelayHours * 3600,
        startAt: start,
        endAt: end,
        events: weekEvents,
      });
      index += 1;
    }
    start += weekSeconds;
  }
  return weeks;
}
