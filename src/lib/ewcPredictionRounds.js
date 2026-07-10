import { effectiveEwcWeekStatus } from './ewcPredictions.js';

function nextLockAt(week, now) {
  const locks = (week?.games || [])
    .map((game) => Number(game?.lockAt))
    .filter((lockAt) => Number.isFinite(lockAt) && lockAt > now);
  return locks.length ? Math.min(...locks) : week?.close_at || null;
}

function displayGame(game) {
  return {
    key: String(game?.key || ''),
    label: [game?.game, game?.event].filter(Boolean).join(' — ') || String(game?.key || 'Game'),
    lockAt: Number.isFinite(Number(game?.lockAt)) ? Number(game.lockAt) : null,
  };
}

// This is deliberately a progress-only projection. It tells a member which
// configured games still need attention without returning any pick values.
export function predictionRoundCompletion(round, picks, now = Math.floor(Date.now() / 1000)) {
  const games = (Array.isArray(round?.games) ? round.games : []).filter((game) => game?.key);
  const gameKeys = new Set(games.map((game) => String(game.key)));
  const pickedGameKeys = new Set(
    (Array.isArray(picks) ? picks : [])
      .map((pick) => (pick && typeof pick === 'object' ? String(pick.gameKey || '') : ''))
      .filter((key) => key && gameKeys.has(key)),
  );
  const openUnpickedGames = [];
  const missedGames = [];
  const locks = [];

  for (const game of games) {
    const item = displayGame(game);
    if (item.lockAt && item.lockAt > now) locks.push(item.lockAt);
    if (pickedGameKeys.has(item.key)) continue;
    if (!item.lockAt || item.lockAt > now) openUnpickedGames.push(item);
    else missedGames.push(item);
  }

  openUnpickedGames.sort((a, b) => (a.lockAt || Infinity) - (b.lockAt || Infinity) || a.label.localeCompare(b.label));
  missedGames.sort((a, b) => (a.lockAt || 0) - (b.lockAt || 0) || a.label.localeCompare(b.label));
  const finalLockAt = locks.length
    ? Math.max(...locks)
    : games.map((game) => Number(game.lockAt)).filter(Number.isFinite).reduce((latest, lockAt) => Math.max(latest, lockAt), null);

  return {
    pickedGames: pickedGameKeys.size,
    totalGames: games.length,
    isComplete: games.length > 0 && pickedGameKeys.size === games.length,
    openUnpickedGames,
    missedGames,
    nextLockAt: locks.length ? Math.min(...locks) : null,
    finalLockAt,
  };
}

// Official events can overlap because rounds are grouped by their finish week
// while individual games lock before they begin. Keep the full set so each
// surface can expose every actionable pick rather than only its default entry.
export function categorizeEwcPredictionRounds(weeks, now = Math.floor(Date.now() / 1000)) {
  const actionable = [];
  const upcoming = [];
  const awaitingScoring = [];

  for (const week of Array.isArray(weeks) ? weeks : []) {
    const status = effectiveEwcWeekStatus(week, now).label;
    const round = { ...week, nextLockAt: nextLockAt(week, now) };
    if (status === 'open' || status === 'partly open') actionable.push(round);
    else if (status === 'opens') upcoming.push(round);
    else if (week.status !== 'scored' && (status === 'locked' || status === 'closed')) awaitingScoring.push(round);
  }

  actionable.sort(
    (a, b) =>
      (a.nextLockAt || Infinity) - (b.nextLockAt || Infinity) ||
      (a.close_at || Infinity) - (b.close_at || Infinity) ||
      String(a.week_key || '').localeCompare(String(b.week_key || '')),
  );
  upcoming.sort(
    (a, b) =>
      (a.open_at || Infinity) - (b.open_at || Infinity) ||
      String(a.week_key || '').localeCompare(String(b.week_key || '')),
  );
  awaitingScoring.sort(
    (a, b) =>
      (b.close_at || b.score_after || 0) - (a.close_at || a.score_after || 0) ||
      String(a.week_key || '').localeCompare(String(b.week_key || '')),
  );
  return { actionable, upcoming, awaitingScoring };
}

// Existing Discord entry points still need one default week. The compatibility
// wrapper deliberately selects the most urgent member of the full model.
export function selectCurrentOpenEwcWeek(weeks, now = Math.floor(Date.now() / 1000)) {
  return categorizeEwcPredictionRounds(weeks, now).actionable[0] || null;
}
