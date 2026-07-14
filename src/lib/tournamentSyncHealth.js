export const TOURNAMENT_SYNC_SOURCES = ['liquipedia', 'startgg', 'pandascore'];
export const TOURNAMENT_SYNC_FAILURE_CATEGORIES = ['rate_limit', 'auth', 'timeout', 'network', 'parse', 'unknown'];

const SOURCE_SET = new Set(TOURNAMENT_SYNC_SOURCES);
const FAILURE_CATEGORY_SET = new Set(TOURNAMENT_SYNC_FAILURE_CATEGORIES);
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

function finiteUnixSeconds(value, fallback = null) {
  const seconds = Math.floor(Number(value));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
}

function errorText(error) {
  return [error?.message, error?.code, error?.name, error?.response?.status]
    .filter((value) => value != null)
    .join(' ')
    .toLowerCase();
}

export function normalizeTournamentSyncSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return SOURCE_SET.has(source) ? source : null;
}

export function normalizeTournamentSyncFailureCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  return FAILURE_CATEGORY_SET.has(category) ? category : 'unknown';
}

// This intentionally returns a closed category only. Provider response details
// remain in process logs and are never stored in the sync-health table.
export function categorizeTournamentSyncError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  const text = errorText(error);
  if (status === 429 || /rate.?limit|too many requests|backing off/.test(text)) return 'rate_limit';
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|auth(?:entication)?|token/.test(text)) return 'auth';
  if (/timeout|timed out|etimedout|abort/.test(text)) return 'timeout';
  if (/econn|enotfound|eai_again|network|socket|connect|dns/.test(text)) return 'network';
  if (/parse|invalid (?:schedule|json|response)|non-array schedule/.test(text)) return 'parse';
  return 'unknown';
}

export function tournamentSyncWindows(pollIntervalMs) {
  const rawInterval = Number(pollIntervalMs);
  const intervalMs = Number.isFinite(rawInterval) && rawInterval > 0
    ? Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.floor(rawInterval)))
    : DEFAULT_POLL_INTERVAL_MS;
  const freshWindowSeconds = Math.max(5 * 60, Math.ceil((2 * intervalMs) / 1000));
  const unavailableAfterSeconds = Math.max(30 * 60, freshWindowSeconds * 2, freshWindowSeconds + 1);
  return { freshWindowSeconds, unavailableAfterSeconds };
}

export function classifyTournamentSyncHealth(
  health,
  {
    archivedAt = null,
    hasRunningMatch = false,
    pollIntervalMs,
    nowSec = Math.floor(Date.now() / 1000),
  } = {},
) {
  const now = finiteUnixSeconds(nowSec, Math.floor(Date.now() / 1000));
  const lastSuccessAt = Math.min(now, finiteUnixSeconds(health?.last_success_at, null) ?? now);
  const hasSuccess = finiteUnixSeconds(health?.last_success_at, null) != null;
  if (archivedAt != null && hasSuccess) return 'final';
  if (!hasSuccess) return 'unavailable';

  const { freshWindowSeconds, unavailableAfterSeconds } = hasRunningMatch
    ? tournamentSyncWindows(pollIntervalMs)
    : { freshWindowSeconds: 30 * 60 * 60, unavailableAfterSeconds: 48 * 60 * 60 };
  const age = Math.max(0, now - lastSuccessAt);
  const consecutiveFailures = Math.max(0, Math.floor(Number(health?.consecutive_failures) || 0));

  if (consecutiveFailures >= 3) return age <= freshWindowSeconds ? 'delayed' : 'unavailable';
  if (age <= freshWindowSeconds) return 'fresh';
  if (age <= unavailableAfterSeconds) return 'delayed';
  return 'unavailable';
}

export function publicTournamentSyncHealth(
  health,
  {
    source,
    archivedAt = null,
    hasRunningMatch = false,
    pollIntervalMs,
    nowSec,
  } = {},
) {
  const normalizedSource = normalizeTournamentSyncSource(source ?? health?.source) || 'liquipedia';
  const lastSuccessAt = finiteUnixSeconds(health?.last_success_at, null);
  return {
    state: classifyTournamentSyncHealth(health, { archivedAt, hasRunningMatch, pollIntervalMs, nowSec }),
    lastSuccessAt,
    source: normalizedSource,
  };
}

export function adminTournamentSyncHealth(health, options = {}) {
  return {
    ...publicTournamentSyncHealth(health, options),
    lastAttemptAt: finiteUnixSeconds(health?.last_attempt_at, null),
    consecutiveFailures: Math.max(0, Math.floor(Number(health?.consecutive_failures) || 0)),
    lastFailureCategory: health?.last_failure_category
      ? normalizeTournamentSyncFailureCategory(health.last_failure_category)
      : null,
    lastItemCount: finiteUnixSeconds(health?.last_item_count, null),
  };
}

export function tournamentSyncSourceLabel(source) {
  const labels = { liquipedia: 'Liquipedia', startgg: 'start.gg', pandascore: 'PandaScore' };
  return labels[normalizeTournamentSyncSource(source)] || 'Source';
}
