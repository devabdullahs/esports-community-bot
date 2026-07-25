import { createHash, randomUUID } from 'node:crypto';

import { all, dbDriver, get, run, transaction } from './client.js';
import {
  normalizeTournamentOperationRequest,
  tournamentOperationTarget,
} from '../lib/tournamentOperationContract.js';

const MAX_IDEMPOTENCY_CHARS = 180;
const MAX_CODE_CHARS = 80;

function nowText() {
  return new Date().toISOString();
}

function boundedCode(value, fallback = null) {
  if (value == null) return fallback;
  const text = String(value).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(text) ? text : fallback;
}

function rowChanges(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    tournamentId: row.tournament_id == null ? null : Number(row.tournament_id),
    operation: row.operation,
    source: row.source,
    sourceId: row.source_id,
    game: row.game,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestedActorId: row.requested_actor_id,
    requestedActorName: row.requested_actor_name,
    requestedActorType: row.requested_actor_type,
    requestedAt: row.requested_at,
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    attempts: Number(row.attempts || 0),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultCode: row.result_code,
    failureCode: row.failure_code,
    resultTournamentId: row.result_tournament_id == null ? null : Number(row.result_tournament_id),
  };
}

export async function enqueueTournamentOperation(input) {
  const request = normalizeTournamentOperationRequest(input);
  if (!request) throw new Error('Invalid tournament operation request.');
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (
    !idempotencyKey ||
    idempotencyKey.length > MAX_IDEMPOTENCY_CHARS ||
    !/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/.test(idempotencyKey)
  ) {
    throw new Error('Invalid tournament operation idempotency key.');
  }
  const existing = await getTournamentOperationByIdempotencyKey(idempotencyKey);
  if (existing) return { operation: existing, created: false };

  const id = randomUUID();
  try {
    await run(
      `INSERT INTO tournament_operations
         (id, guild_id, tournament_id, operation, source, source_id, game,
          idempotency_key, requested_actor_id, requested_actor_name,
          requested_actor_type, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        request.guildId,
        request.tournamentId,
        request.operation,
        request.source,
        request.sourceId,
        request.game,
        idempotencyKey,
        request.requestedActorId,
        request.requestedActorName,
        request.requestedActorType,
        nowText(),
      ],
    );
  } catch (error) {
    const duplicate = await getTournamentOperationByIdempotencyKey(idempotencyKey);
    if (duplicate) return { operation: duplicate, created: false };
    throw error;
  }
  const operation = await getTournamentOperation(id);
  if (!operation) throw new Error('Tournament operation could not be persisted.');
  return { operation, created: true };
}

export async function getTournamentOperation(id) {
  return hydrate(await get('SELECT * FROM tournament_operations WHERE id = $1', [id]));
}

export async function getTournamentOperationByIdempotencyKey(idempotencyKey) {
  return hydrate(await get('SELECT * FROM tournament_operations WHERE idempotency_key = $1', [idempotencyKey]));
}

/**
 * @param {{ guildId?: string | null, tournamentId?: number | null, limit?: number }} [options]
 */
export async function listTournamentOperations({ guildId, tournamentId, limit = 100 } = {}) {
  const params = [];
  const where = [];
  if (guildId) {
    params.push(String(guildId));
    where.push(`guild_id = $${params.length}`);
  }
  if (tournamentId) {
    params.push(Number(tournamentId));
    where.push(`tournament_id = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(200, Number(limit) || 100)));
  const rows = await all(
    `SELECT * FROM tournament_operations
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY requested_at DESC, id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(hydrate);
}

export async function claimNextTournamentOperation({ nowSec = Date.now() / 1000, leaseSeconds = 600 } = {}) {
  const claimedAt = Math.floor(Number(nowSec));
  if (!Number.isSafeInteger(claimedAt)) throw new Error('A valid lease time is required.');
  const leaseToken = randomUUID();
  const leaseExpiresAt = claimedAt + Math.max(60, Math.min(3_600, Math.floor(Number(leaseSeconds)) || 600));
  return transaction(async (tx) => {
    const lock = dbDriver() === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
    const candidate = await tx.get(
      `SELECT * FROM tournament_operations
       WHERE attempts < 20
         AND (status = 'queued' OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1))
       ORDER BY requested_at, id
       LIMIT 1${lock}`,
      [claimedAt],
    );
    if (!candidate) return null;
    const claimed = await tx.run(
      `UPDATE tournament_operations
       SET status = 'running', lease_token = $1, lease_expires_at = $2,
           attempts = attempts + 1, started_at = COALESCE(started_at, $3),
           completed_at = NULL, result_code = NULL, failure_code = NULL
       WHERE id = $4 AND attempts < 20
         AND (status = 'queued' OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $5))`,
      [leaseToken, leaseExpiresAt, nowText(), candidate.id, claimedAt],
    );
    if (!rowChanges(claimed)) return null;
    return {
      operation: hydrate(await tx.get('SELECT * FROM tournament_operations WHERE id = $1', [candidate.id])),
      leaseToken,
    };
  });
}

export async function completeTournamentOperation({ id, leaseToken, resultCode, tournamentId = null }) {
  const updated = await run(
    `UPDATE tournament_operations
     SET status = 'succeeded', lease_token = NULL, lease_expires_at = NULL,
         completed_at = $1, result_code = $2, failure_code = NULL,
         result_tournament_id = $3
     WHERE id = $4 AND status = 'running' AND lease_token = $5`,
    [nowText(), boundedCode(resultCode, 'completed'), tournamentId, id, leaseToken],
  );
  return Boolean(rowChanges(updated));
}

export async function failTournamentOperation({ id, leaseToken, failureCode }) {
  const updated = await run(
    `UPDATE tournament_operations
     SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
         completed_at = $1, result_code = NULL, failure_code = $2
     WHERE id = $3 AND status = 'running' AND lease_token = $4`,
    [nowText(), boundedCode(failureCode, 'operation_failed'), id, leaseToken],
  );
  return Boolean(rowChanges(updated));
}

export async function requeueTournamentOperation({ id, leaseToken, failureCode }) {
  const updated = await run(
    `UPDATE tournament_operations
     SET status = 'queued', lease_token = NULL, lease_expires_at = NULL,
         completed_at = NULL, result_code = NULL, failure_code = $1
     WHERE id = $2 AND status = 'running' AND lease_token = $3 AND attempts < 20`,
    [boundedCode(failureCode, 'retryable_failure'), id, leaseToken],
  );
  return Boolean(rowChanges(updated));
}

export async function retryTournamentOperation(id) {
  const updated = await run(
    `UPDATE tournament_operations
     SET status = 'queued', lease_token = NULL, lease_expires_at = NULL,
         completed_at = NULL, failure_code = NULL, result_code = NULL
     WHERE id = $1 AND status = 'failed' AND attempts < 20`,
    [id],
  );
  return Boolean(rowChanges(updated));
}

export function tournamentOperationIdempotencyKey(request, nonce) {
  const normalized = normalizeTournamentOperationRequest(request);
  if (!normalized) throw new Error('Invalid tournament operation request.');
  const safeNonce = String(nonce || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
  if (!safeNonce) throw new Error('Tournament operation request nonce is required.');
  const targetDigest = createHash('sha256')
    .update(tournamentOperationTarget(normalized))
    .digest('hex')
    .slice(0, 24);
  return `tournament:${normalized.operation}:${targetDigest}:${safeNonce}`;
}
