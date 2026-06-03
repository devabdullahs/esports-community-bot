import { normalizeTeamName } from './render.js';

const RIYADH_OFFSET = '+03:00';

export const WEEKLY_TOP_THREE_SWEEP_BONUS = 300;
export const SEASON_EXACT_RANK_BONUS = 250;

export function normalizeClubName(name) {
  return String(name ?? '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function clubNameKeys(name) {
  const base = normalizeClubName(name);
  const noTeamPrefix = base.replace(/^team\s+/, '');
  const compact = normalizeTeamName(name);
  return [...new Set([base, noTeamPrefix, compact].filter(Boolean))];
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

export function parsePredictionDate(input) {
  const value = String(input ?? '').trim();
  if (!value) return null;
  const discord = value.match(/<t:(\d+)(?::[tTdDfFR])?>/);
  if (discord) return Number(discord[1]);
  if (/^\d{10}$/.test(value)) return Number(value);
  if (/^\d{13}$/.test(value)) return Math.floor(Number(value) / 1000);

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}${RIYADH_OFFSET}`;
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

export function generateEwcWeekWindows(events, { openBeforeHours = 48, scoreDelayHours = 24 } = {}) {
  const dated = (events || []).filter((event) => event.startAt && event.endAt).sort((a, b) => a.startAt - b.startAt);
  if (!dated.length) return [];
  const firstStart = dated[0].startAt;
  const lastEnd = Math.max(...dated.map((event) => event.endAt));
  const weekSeconds = 7 * 24 * 3600;
  const weeks = [];
  let start = firstStart;
  let index = 1;
  while (start <= lastEnd) {
    const end = start + weekSeconds - 1;
    const weekEvents = dated.filter((event) => event.startAt <= end && event.endAt >= start);
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
