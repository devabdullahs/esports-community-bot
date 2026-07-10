import { effectiveEwcWeekStatus } from './ewcPredictions.js';

// Pick the same round everywhere a member needs a "current week" entry point.
// Multiple concurrently open rounds are valid; the one closing first is the
// most urgent. Stable keys make the result deterministic when times tie.
export function selectCurrentOpenEwcWeek(weeks, now = Math.floor(Date.now() / 1000)) {
  const open = (Array.isArray(weeks) ? weeks : []).filter((week) => {
    const label = effectiveEwcWeekStatus(week, now).label;
    return label === 'open' || label === 'partly open';
  });
  if (!open.length) return null;
  return open.toSorted(
    (a, b) =>
      (a.close_at || Infinity) - (b.close_at || Infinity) ||
      String(a.week_key || '').localeCompare(String(b.week_key || '')),
  )[0];
}
