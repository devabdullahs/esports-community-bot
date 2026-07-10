export const EWC_PREDICTION_ADMIN_OPERATIONS = Object.freeze([
  'refresh_leaderboard',
  'generate_weeks',
  'snapshot_week',
  'score_week',
  'score_season',
  'reopen_week',
  'reopen_season',
  'delete_week',
]);

const WEEK_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function validInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

function validWeekKey(value) {
  return typeof value === 'string' && WEEK_KEY.test(value) ? value : null;
}

function error(message) {
  return { ok: false, error: message };
}

// Kept configuration-free so the Next.js requester can enforce the same closed
// input contract without loading bot runtime configuration or Discord services.
export function validateEwcPredictionAdminOperation(operation, args, { defaultScoreDelayHours = 24 } = {}) {
  if (!EWC_PREDICTION_ADMIN_OPERATIONS.includes(operation)) return error('Unsupported prediction operation.');
  const input = args ?? {};
  if (operation === 'refresh_leaderboard' || operation === 'score_season' || operation === 'reopen_season') {
    return exactKeys(input, []) ? { ok: true, value: {} } : error('This operation does not accept arguments.');
  }
  if (operation === 'generate_weeks') {
    if (!exactKeys(input, ['openBeforeHours', 'lockBeforeHours', 'scoreDelayHours'])) return error('Invalid generation arguments.');
    const value = {
      openBeforeHours: input.openBeforeHours ?? 48,
      lockBeforeHours: input.lockBeforeHours ?? 24,
      scoreDelayHours: input.scoreDelayHours ?? defaultScoreDelayHours,
    };
    if (!validInteger(value.openBeforeHours, 0, 336) || !validInteger(value.lockBeforeHours, 0, 168) || !validInteger(value.scoreDelayHours, 0, 336)) {
      return error('Invalid generation timing.');
    }
    return { ok: true, value };
  }
  if (operation === 'snapshot_week') {
    if (!exactKeys(input, ['weekKey', 'type'])) return error('Invalid snapshot arguments.');
    const weekKey = validWeekKey(input.weekKey);
    if (!weekKey || !['baseline', 'final'].includes(input.type)) return error('Invalid snapshot arguments.');
    return { ok: true, value: { weekKey, type: input.type } };
  }
  if (operation === 'score_week' || operation === 'reopen_week') {
    if (!exactKeys(input, ['weekKey'])) return error('Invalid round arguments.');
    const weekKey = validWeekKey(input.weekKey);
    return weekKey ? { ok: true, value: { weekKey } } : error('Invalid week key.');
  }
  if (operation === 'delete_week') {
    if (!exactKeys(input, ['weekKey', 'confirmationWeekKey'])) return error('Invalid deletion arguments.');
    const weekKey = validWeekKey(input.weekKey);
    if (!weekKey || input.confirmationWeekKey !== weekKey) return error('Type the exact week key to confirm deletion.');
    return { ok: true, value: { weekKey, confirmationWeekKey: weekKey } };
  }
  return error('Unsupported prediction operation.');
}
