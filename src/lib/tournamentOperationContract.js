import { normalizeTournamentOperationInput } from './parseTournamentInput.js';

export const TOURNAMENT_OPERATIONS = Object.freeze([
  'validate_and_activate',
  'sync_schedule',
  'sync_standings',
  'archive',
  'deactivate',
  'reactivate',
]);
export const TOURNAMENT_OPERATION_ACTOR_TYPES = Object.freeze(['discord_admin', 'web_admin', 'system']);

const OPERATION_SET = new Set(TOURNAMENT_OPERATIONS);
const ACTOR_SET = new Set(TOURNAMENT_OPERATION_ACTOR_TYPES);

export function normalizeTournamentOperationRequest(input = {}) {
  const operation = String(input.operation || '').trim();
  const guildId = String(input.guildId || '').trim();
  const actorType = String(input.requestedActorType || '').trim();
  if (!OPERATION_SET.has(operation) || !/^\d{1,32}$/.test(guildId) || !ACTOR_SET.has(actorType)) return null;

  const actorId = input.requestedActorId == null ? null : String(input.requestedActorId).trim().slice(0, 64);
  const actorName = input.requestedActorName == null
    ? null
    : String(input.requestedActorName).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);

  if (operation === 'validate_and_activate') {
    const identity = normalizeTournamentOperationInput({
      source: input.source,
      sourceId: input.sourceId,
      game: input.game,
    });
    if (!identity) return null;
    return {
      guildId,
      tournamentId: null,
      operation,
      source: identity.source,
      sourceId: identity.sourceId,
      game: identity.game,
      requestedActorId: actorId,
      requestedActorName: actorName,
      requestedActorType: actorType,
    };
  }

  const tournamentId = Math.floor(Number(input.tournamentId));
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) return null;
  return {
    guildId,
    tournamentId,
    operation,
    source: null,
    sourceId: null,
    game: null,
    requestedActorId: actorId,
    requestedActorName: actorName,
    requestedActorType: actorType,
  };
}

export function tournamentOperationTarget(request) {
  return request.operation === 'validate_and_activate'
    ? `${request.source}:${request.sourceId}`
    : `tournament:${request.tournamentId}`;
}
