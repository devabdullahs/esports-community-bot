import { normalizeTeamName } from './render.js';

export const MATCH_STATUSES = Object.freeze([
  'scheduled',
  'running',
  'finished',
  'postponed',
  'cancelled',
]);
export const MATCH_WINNER_SIDES = Object.freeze(['team1', 'team2', 'draw']);
export const MATCH_RESULT_REASONS = Object.freeze([
  'normal',
  'walkover',
  'forfeit',
  'cancelled',
  'postponed',
  'unknown',
]);

const STATUS_SET = new Set(MATCH_STATUSES);
const WINNER_SET = new Set(MATCH_WINNER_SIDES);
const REASON_SET = new Set(MATCH_RESULT_REASONS);
const TERMINAL_STATUSES = new Set(['finished', 'cancelled']);

function canonicalValue(value, allowed) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : null;
}

function numericScore(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scheduledAtOf(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function canonicalMatchStatus(value) {
  return canonicalValue(value, STATUS_SET);
}

export function inferWinnerSideFromScores(scoreA, scoreB) {
  const a = numericScore(scoreA);
  const b = numericScore(scoreB);
  if (a == null || b == null || a === b) return null;
  return a > b ? 'team1' : 'team2';
}

export function winnerSideFromWinnerName(winner, teamA, teamB) {
  const winnerKey = normalizeTeamName(winner);
  if (!winnerKey) return null;
  const teamAKey = normalizeTeamName(teamA);
  const teamBKey = normalizeTeamName(teamB);
  if (teamAKey && winnerKey === teamAKey && winnerKey !== teamBKey) return 'team1';
  if (teamBKey && winnerKey === teamBKey && winnerKey !== teamAKey) return 'team2';
  return null;
}

function explicitWinnerSide(input) {
  return (
    canonicalValue(input?.winner_side ?? input?.winnerSide, WINNER_SET) ||
    winnerSideFromWinnerName(
      input?.winner,
      input?.team_a ?? input?.teamA,
      input?.team_b ?? input?.teamB,
    )
  );
}

function resultReason(input) {
  return canonicalValue(input?.result_reason ?? input?.resultReason, REASON_SET) || 'unknown';
}

export function normalizeMatchLifecycle(input = {}) {
  const status = canonicalMatchStatus(input.status);
  let winnerSide = explicitWinnerSide(input);
  let reason = resultReason(input);

  if (status === 'cancelled' || status === 'postponed') {
    winnerSide = null;
    reason = status;
  } else if (status === 'finished') {
    winnerSide =
      winnerSide ||
      inferWinnerSideFromScores(
        input.score_a ?? input.scoreA,
        input.score_b ?? input.scoreB,
      );
    if (
      reason === 'unknown' &&
      winnerSide &&
      inferWinnerSideFromScores(
        input.score_a ?? input.scoreA,
        input.score_b ?? input.scoreB,
      )
    ) {
      reason = 'normal';
    }
  } else {
    winnerSide = null;
    reason = 'unknown';
  }

  return {
    status,
    winner_side: winnerSide,
    result_reason: reason,
    status_known: status != null,
  };
}

function transitionAccepted(existing, incoming, incomingRow) {
  if (!incoming.status_known) return false;
  if (!existing.status_known) return true;
  if (existing.status === incoming.status) return true;
  if (TERMINAL_STATUSES.has(existing.status)) return false;

  if (existing.status === 'postponed' && incoming.status === 'scheduled') {
    const oldTime = scheduledAtOf(incomingRow?.previous_scheduled_at);
    const newTime = scheduledAtOf(incomingRow?.scheduled_at ?? incomingRow?.scheduledAt);
    return oldTime != null && newTime != null && oldTime !== newTime;
  }

  if (existing.status === 'running' && incoming.status === 'scheduled') return false;
  return true;
}

export function mergeMatchLifecycle(existingInput = {}, incomingInput = {}) {
  const existing = normalizeMatchLifecycle(existingInput);
  const incoming = normalizeMatchLifecycle(incomingInput);
  const accepted = transitionAccepted(existing, incoming, {
    ...incomingInput,
    previous_scheduled_at:
      existingInput.scheduled_at ?? existingInput.scheduledAt ?? null,
  });
  const status = accepted ? incoming.status : existing.status || incoming.status || 'scheduled';

  if (status === 'cancelled' || status === 'postponed') {
    return {
      status,
      winner_side: null,
      result_reason: status,
      status_known: true,
      status_accepted: accepted,
    };
  }

  if (status !== 'finished') {
    return {
      status,
      winner_side: null,
      result_reason: 'unknown',
      status_known: true,
      status_accepted: accepted,
    };
  }

  const useIncomingOutcome = incoming.status === 'finished' && (accepted || existing.status === 'finished');
  const winnerSide =
    (useIncomingOutcome ? incoming.winner_side : null) ||
    existing.winner_side ||
    null;
  const incomingReason = useIncomingOutcome ? incoming.result_reason : 'unknown';
  const reason =
    incomingReason !== 'unknown'
      ? incomingReason
      : existing.result_reason !== 'unknown'
        ? existing.result_reason
        : 'unknown';

  return {
    status,
    winner_side: winnerSide,
    result_reason: reason,
    status_known: true,
    status_accepted: accepted,
  };
}
