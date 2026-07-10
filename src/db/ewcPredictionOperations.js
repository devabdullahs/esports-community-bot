import { randomUUID } from 'node:crypto';

import { all, dbDriver, get, run, transaction } from './client.js';

const MAX_JSON_CHARS = 2_000;
const MAX_ERROR_CHARS = 500;
const MAX_RESULT_CHARS = 2_000;

function nowText() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function boundedJson(value, fallback = {}) {
  const serialized = JSON.stringify(value ?? fallback);
  if (serialized.length > MAX_JSON_CHARS) throw new Error('Operation metadata is too large.');
  return serialized;
}

export function sanitizeEwcPredictionOperationText(value, fallback = 'Operation failed.') {
  const text = String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, MAX_ERROR_CHARS);
}

function changes(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    season: row.season,
    operation: row.operation,
    args: parseJson(row.args_json, {}),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestedActorId: row.requested_actor_id,
    requestedActorType: row.requested_actor_type,
    requestedAt: row.requested_at,
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    attempts: Number(row.attempts || 0),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    result: parseJson(row.result_json, null),
    error: row.error_text,
  };
}

/**
 * @param {{
 *   guildId: string,
 *   season: string,
 *   operation: string,
 *   args: unknown,
 *   idempotencyKey: string,
 *   requestedActorId?: string|null,
 *   requestedActorType?: string
 * }} input
 */
export async function enqueueEwcPredictionOperation({
  guildId,
  season,
  operation,
  args,
  idempotencyKey,
  requestedActorId = null,
  requestedActorType = 'web-admin',
}) {
  const id = randomUUID();
  const requestedAt = nowText();
  const argsJson = boundedJson(args);
  try {
    await run(
      `INSERT INTO ewc_prediction_operations
         (id, guild_id, season, operation, args_json, status, idempotency_key,
          requested_actor_id, requested_actor_type, requested_at)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8, $9)`,
      [id, guildId, season, operation, argsJson, idempotencyKey, requestedActorId, requestedActorType, requestedAt],
    );
  } catch (error) {
    // A duplicate submission is an idempotent success, not an error. The
    // operation is returned so the caller can continue polling the same work.
    const existing = await getEwcPredictionOperationByIdempotencyKey(idempotencyKey);
    if (existing) return { operation: existing, created: false };
    throw error;
  }
  return { operation: await getEwcPredictionOperation(id), created: true };
}

export async function getEwcPredictionOperation(id) {
  return hydrate(await get('SELECT * FROM ewc_prediction_operations WHERE id = $1', [id]));
}

export async function getEwcPredictionOperationByIdempotencyKey(idempotencyKey) {
  return hydrate(await get('SELECT * FROM ewc_prediction_operations WHERE idempotency_key = $1', [idempotencyKey]));
}

/** @param {{guildId?: string, season?: string, limit?: number}} filter */
export async function listEwcPredictionOperations({ guildId, season, limit = 50 } = {}) {
  const params = [];
  const where = [];
  if (guildId) {
    params.push(guildId);
    where.push(`guild_id = $${params.length}`);
  }
  if (season) {
    params.push(season);
    where.push(`season = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(100, Number(limit) || 50)));
  return (
    await all(
      `SELECT * FROM ewc_prediction_operations
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY requested_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    )
  ).map(hydrate);
}

export async function claimNextEwcPredictionOperation({ nowSec, leaseSeconds = 300 } = {}) {
  const claimedAt = Math.floor(Number(nowSec ?? Date.now() / 1000));
  if (!Number.isSafeInteger(claimedAt)) throw new Error('A valid operation lease time is required.');
  const token = randomUUID();
  const expiresAt = claimedAt + Math.max(30, Math.min(3_600, Math.floor(Number(leaseSeconds)) || 300));
  return transaction(async (client) => {
    const lock = dbDriver() === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
    const candidate = await client.get(
      `SELECT * FROM ewc_prediction_operations
       WHERE status = 'queued' OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
       ORDER BY requested_at, id
       LIMIT 1${lock}`,
      [claimedAt],
    );
    if (!candidate) return null;
    const claimed = await client.run(
      `UPDATE ewc_prediction_operations
       SET status = 'running', lease_token = $1, lease_expires_at = $2,
           attempts = attempts + 1, started_at = COALESCE(started_at, $3),
           completed_at = NULL, error_text = NULL
       WHERE id = $4
         AND (status = 'queued' OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $5))`,
      [token, expiresAt, nowText(), candidate.id, claimedAt],
    );
    if (!changes(claimed)) return null;
    const operation = await client.get('SELECT * FROM ewc_prediction_operations WHERE id = $1', [candidate.id]);
    return { operation: hydrate(operation), leaseToken: token };
  });
}

export async function completeEwcPredictionOperation({ id, leaseToken, result }) {
  const serialized = boundedJson(result ?? {}, {});
  if (serialized.length > MAX_RESULT_CHARS) throw new Error('Operation result is too large.');
  const updated = await run(
    `UPDATE ewc_prediction_operations
     SET status = 'succeeded', lease_token = NULL, lease_expires_at = NULL,
         completed_at = $1, result_json = $2, error_text = NULL
     WHERE id = $3 AND status = 'running' AND lease_token = $4`,
    [nowText(), serialized, id, leaseToken],
  );
  return Boolean(changes(updated));
}

export async function failEwcPredictionOperation({ id, leaseToken, error }) {
  const updated = await run(
    `UPDATE ewc_prediction_operations
     SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
         completed_at = $1, error_text = $2
     WHERE id = $3 AND status = 'running' AND lease_token = $4`,
    [nowText(), sanitizeEwcPredictionOperationText(error), id, leaseToken],
  );
  return Boolean(changes(updated));
}

export async function retryEwcPredictionOperation(id) {
  const updated = await run(
    `UPDATE ewc_prediction_operations
     SET status = 'queued', lease_token = NULL, lease_expires_at = NULL,
         completed_at = NULL, error_text = NULL
     WHERE id = $1 AND status = 'failed'`,
    [id],
  );
  return Boolean(changes(updated));
}

export async function recordEwcPredictionAutomationHealth({ guildId, season, ok, error = null }) {
  const at = nowText();
  const safeError = ok ? null : sanitizeEwcPredictionOperationText(error);
  await run(
    `INSERT INTO ewc_prediction_operation_health
       (guild_id, season, last_attempt_at, last_success_at, last_error)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, season) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = CASE WHEN excluded.last_success_at IS NULL
                              THEN ewc_prediction_operation_health.last_success_at
                              ELSE excluded.last_success_at END,
       last_error = excluded.last_error`,
    [guildId, season, at, ok ? at : null, safeError],
  );
}

export async function getEwcPredictionAutomationHealth(guildId, season) {
  const row = await get(
    'SELECT guild_id, season, last_attempt_at, last_success_at, last_error FROM ewc_prediction_operation_health WHERE guild_id = $1 AND season = $2',
    [guildId, season],
  );
  return row
    ? {
        guildId: row.guild_id,
        season: row.season,
        lastAttemptAt: row.last_attempt_at,
        lastSuccessAt: row.last_success_at,
        lastError: row.last_error,
      }
    : null;
}
