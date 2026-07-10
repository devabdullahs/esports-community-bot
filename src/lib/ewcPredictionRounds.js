import { effectiveEwcWeekStatus } from './ewcPredictions.js';

function nextLockAt(week, now) {
  const locks = (week?.games || [])
    .map((game) => Number(game?.lockAt))
    .filter((lockAt) => Number.isFinite(lockAt) && lockAt > now);
  return locks.length ? Math.min(...locks) : week?.close_at || null;
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
