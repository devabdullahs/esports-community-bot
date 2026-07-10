const MAX_WEEKLY_ROWS = 20;
const MAX_LEGACY_ROWS = 3;
const MAX_SEASON_ROWS = 10;
const MAX_TEXT_LENGTH = 160;

function text(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, MAX_TEXT_LENGTH) : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unavailable(kind, total) {
  return {
    available: false,
    kind,
    total: number(total),
    bonus: 0,
    rows: [],
    integrity: 'unavailable',
  };
}

function withIntegrity(kind, total, bonus, rows) {
  const normalizedTotal = number(total);
  const normalizedBonus = number(bonus);
  const projectedTotal = rows.reduce((sum, row) => sum + number(row.points), 0) + normalizedBonus;
  return {
    available: true,
    kind,
    total: normalizedTotal,
    bonus: normalizedBonus,
    rows,
    integrity: projectedTotal === normalizedTotal ? 'ok' : 'mismatch',
  };
}

function weeklyPerGameRow(detail) {
  const pick = text(detail?.pick);
  const matchedClub = text(detail?.matchedClub || detail?.participant);
  const late = Boolean(detail?.late);
  const status = late ? 'late' : !pick ? 'missed' : !matchedClub ? 'unmatched' : 'scored';
  return {
    game: text([detail?.game, detail?.event].filter(Boolean).join(' — ')) || text(detail?.gameKey) || 'Game',
    pick,
    matchedClub,
    placement: text(detail?.place),
    points: number(detail?.points),
    winner: text(detail?.winner),
    status,
  };
}

export function projectWeeklyScoreBreakdown(prediction) {
  if (prediction?.score == null) return null;
  const details = prediction.details;
  if (!details || typeof details !== 'object' || !Array.isArray(details.picks)) {
    return unavailable('weekly', prediction.score);
  }

  if (details.mode === 'per-game') {
    const rows = details.picks.slice(0, MAX_WEEKLY_ROWS).map(weeklyPerGameRow);
    return withIntegrity('weekly-per-game', prediction.score, details.bonus, rows);
  }

  const rows = details.picks.slice(0, MAX_LEGACY_ROWS).map((detail) => {
    const pick = text(detail?.pick);
    const matchedTeam = text(detail?.matchedTeam);
    return {
      pick,
      matchedTeam,
      weeklyRank: nullableNumber(detail?.rank),
      points: number(detail?.weeklyPoints),
      status: !pick ? 'missed' : matchedTeam ? 'scored' : 'unmatched',
    };
  });
  return withIntegrity('weekly-aggregate', prediction.score, details.bonus, rows);
}

export function projectSeasonScoreBreakdown(prediction) {
  if (prediction?.score == null) return null;
  const details = prediction.details;
  if (!details || typeof details !== 'object' || !Array.isArray(details.picks)) {
    return unavailable('season', prediction.score);
  }

  const rows = details.picks.slice(0, MAX_SEASON_ROWS).map((detail) => {
    const pick = text(detail?.pick);
    const matchedTeam = text(detail?.matchedTeam);
    return {
      pick,
      matchedTeam,
      predictedRank: nullableNumber(detail?.predictedRank),
      actualRank: nullableNumber(detail?.actualRank),
      hitPoints: number(detail?.hitPoints),
      exactBonus: number(detail?.exactBonus),
      points: number(detail?.points),
      status: !pick ? 'missed' : matchedTeam ? 'scored' : 'unmatched',
    };
  });
  return withIntegrity('season', prediction.score, 0, rows);
}
