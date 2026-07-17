// Achievement state is intentionally derived from finalized prediction results.
// These IDs, thresholds, and labels are public contract values for web surfaces.
export const EWC_PREDICTION_ACHIEVEMENTS = Object.freeze({
  WEEKLY_WINNER: Object.freeze({
    id: 'weekly-winner',
    threshold: { minimumWins: 1 },
    labels: { en: 'Weekly winner', ar: '\u0641\u0627\u0626\u0632 \u0623\u0633\u0628\u0648\u0639\u064a' },
  }),
  TOP_TEN: Object.freeze({
    id: 'top-ten',
    threshold: { minimumRank: 1, maximumRank: 10 },
    labels: { en: 'Top 10', ar: '\u0636\u0645\u0646 \u0623\u0641\u0636\u0644 10' },
  }),
  TOP_TWENTY: Object.freeze({
    id: 'top-twenty',
    threshold: { minimumRank: 11, maximumRank: 20 },
    labels: { en: 'Top 20', ar: '\u0636\u0645\u0646 \u0623\u0641\u0636\u0644 20' },
  }),
  PERFECT_WEEK: Object.freeze({
    id: 'perfect-week',
    threshold: { minimumPerfectWeeks: 1 },
    labels: { en: 'Perfect week', ar: '\u0623\u0633\u0628\u0648\u0639 \u0645\u062b\u0627\u0644\u064a' },
  }),
  SCORING_STREAK: Object.freeze({
    id: 'scoring-streak',
    threshold: { minimumWeeks: 3 },
    labels: { en: 'Scoring streak', ar: '\u0633\u0644\u0633\u0644\u0629 \u0646\u0642\u0627\u0637' },
  }),
  GAME_SPECIALIST: Object.freeze({
    id: 'game-specialist',
    threshold: { minimumCorrectWinners: 3 },
    labels: { en: 'Game specialist', ar: '\u0645\u062a\u062e\u0635\u0635 \u0644\u0639\u0628\u0629' },
  }),
  CONSISTENT_PREDICTOR: Object.freeze({
    id: 'consistent-predictor',
    threshold: { minimumScoredWeeks: 5 },
    labels: { en: 'Consistent predictor', ar: '\u0645\u062a\u0648\u0642\u0639 \u0645\u0648\u0627\u0638\u0628' },
  }),
});

export const EWC_PREDICTION_ACHIEVEMENT_IDS = Object.freeze(
  Object.values(EWC_PREDICTION_ACHIEVEMENTS).map((achievement) => achievement.id),
);

function positiveInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function finalizedWeeklyRows(weeklyRows) {
  return Array.isArray(weeklyRows)
    ? weeklyRows.filter((row) => row?.status === 'scored')
    : [];
}

function scoringStreak(weeklyRows) {
  let current = 0;
  let longest = 0;
  for (const row of finalizedWeeklyRows(weeklyRows)) {
    if (Number(row?.score) > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return { current, longest };
}

function specialistGame(weeklyRows) {
  const correctByGame = new Map();
  for (const row of finalizedWeeklyRows(weeklyRows)) {
    if (row?.details?.mode !== 'per-game' || !Array.isArray(row.details.picks)) continue;
    for (const pick of row.details.picks) {
      const game = String(pick?.game || '').trim();
      if (!game || Number(pick?.points) !== 1000 || pick?.late || !pick?.resultAvailable) continue;
      const key = game.toLowerCase();
      const current = correctByGame.get(key) || { game, correctWinners: 0 };
      current.correctWinners += 1;
      correctByGame.set(key, current);
    }
  }

  return [...correctByGame.values()].sort(
    (left, right) => right.correctWinners - left.correctWinners || left.game.localeCompare(right.game),
  )[0] || { game: null, correctWinners: 0 };
}

function hasPerfectWeek(weeklyRows) {
  return finalizedWeeklyRows(weeklyRows).some((row) => row?.details?.mode === 'per-game' && row.details.allWinners === true);
}

function rankedBetween(rank, threshold) {
  const normalizedRank = positiveInteger(rank);
  return normalizedRank >= threshold.minimumRank && normalizedRank <= threshold.maximumRank;
}

// The input contains only scored-week outcomes. Missing or zero-scored weeks
// break a streak, and a zero-score leaderboard tie cannot produce weeklyWins.
export function deriveEwcPredictionAchievements({ rank, weeklyWins = 0, weeksScored = 0, weeklyRows = [] } = {}) {
  const definitions = EWC_PREDICTION_ACHIEVEMENTS;
  const streak = scoringStreak(weeklyRows);
  const specialist = specialistGame(weeklyRows);
  const ids = [];

  if (positiveInteger(weeklyWins) >= definitions.WEEKLY_WINNER.threshold.minimumWins) ids.push(definitions.WEEKLY_WINNER.id);
  if (rankedBetween(rank, definitions.TOP_TEN.threshold)) ids.push(definitions.TOP_TEN.id);
  if (rankedBetween(rank, definitions.TOP_TWENTY.threshold)) ids.push(definitions.TOP_TWENTY.id);
  if (hasPerfectWeek(weeklyRows)) ids.push(definitions.PERFECT_WEEK.id);
  if (streak.longest >= definitions.SCORING_STREAK.threshold.minimumWeeks) ids.push(definitions.SCORING_STREAK.id);
  if (specialist.correctWinners >= definitions.GAME_SPECIALIST.threshold.minimumCorrectWinners) ids.push(definitions.GAME_SPECIALIST.id);
  if (positiveInteger(weeksScored) >= definitions.CONSISTENT_PREDICTOR.threshold.minimumScoredWeeks) {
    ids.push(definitions.CONSISTENT_PREDICTOR.id);
  }

  return {
    ids,
    stats: {
      currentScoringStreak: streak.current,
      longestScoringStreak: streak.longest,
      specialistGame: specialist.game,
      specialistCorrectWinners: specialist.correctWinners,
      scoredWeeks: positiveInteger(weeksScored),
    },
  };
}
