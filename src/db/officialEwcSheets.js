import { createHash } from 'node:crypto';
import { get, run, transaction } from './client.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function opaqueWorkbookKey(workbookId) {
  return createHash('sha256').update(String(workbookId)).digest('hex');
}

export async function getOfficialFeedState(workbookKey) {
  return get('SELECT * FROM official_feed_state WHERE workbook_key = $1', [workbookKey]);
}

export async function saveOfficialFeedState({ workbookKey, modifiedToken, hash, observedAt }) {
  return run(
    `INSERT INTO official_feed_state
       (workbook_key, modified_token, content_hash, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workbook_key) DO UPDATE SET
       modified_token = excluded.modified_token,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`,
    [workbookKey, modifiedToken, hash, observedAt],
  );
}

export async function getFreshMatchAuthority(matchId, { client = null, now = Math.floor(Date.now() / 1000) } = {}) {
  const reader = client || { get };
  const row = await reader.get(
    'SELECT fields_json, expires_at FROM official_match_authority WHERE match_id = $1',
    [matchId],
  );
  if (!row) return null;
  try {
    const fields = JSON.parse(row.fields_json);
    if (!Array.isArray(fields)) return null;
    const protectedFields = fields.filter((field) => typeof field === 'string');
    // Scores and lifecycle state may fall back to another provider when the official
    // feed goes stale. A published official start time remains the schedule of record.
    if (row.expires_at <= now) {
      return protectedFields.includes('scheduled_at') ? new Set(['scheduled_at']) : null;
    }
    return new Set(protectedFields);
  } catch {
    return null;
  }
}

export async function saveOfficialMatchAuthority(
  client,
  { matchId, observedAt, expiresAt, hash, fields },
) {
  return client.run(
    `INSERT INTO official_match_authority
       (match_id, observed_at, expires_at, content_hash, fields_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (match_id) DO UPDATE SET
       observed_at = excluded.observed_at,
       expires_at = excluded.expires_at,
       content_hash = excluded.content_hash,
       fields_json = excluded.fields_json`,
    [matchId, observedAt, expiresAt, hash, JSON.stringify([...fields].sort())],
  );
}

export async function upsertOfficialTournamentOverview(
  tournamentId,
  payload,
  { observedAt = Math.floor(Date.now() / 1000), ttlSeconds = 300 } = {},
) {
  const normalized = stableValue(payload);
  const hash = contentHash(normalized);
  const expiresAt = observedAt + ttlSeconds;
  const updatedAt = nowText();
  await transaction(async (tx) => {
    await tx.run(
      `INSERT INTO tournament_overviews (tournament_id, payload_json, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
      [tournamentId, JSON.stringify(normalized), updatedAt],
    );
    await tx.run(
      `INSERT INTO official_overview_authority
         (tournament_id, observed_at, expires_at, content_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tournament_id) DO UPDATE SET
         observed_at = excluded.observed_at,
         expires_at = excluded.expires_at,
         content_hash = excluded.content_hash`,
      [tournamentId, observedAt, expiresAt, hash],
    );
  });
  return { hash, updatedAt };
}

export async function getTournamentOverview(tournamentId) {
  const row = await get('SELECT payload_json, updated_at FROM tournament_overviews WHERE tournament_id = $1', [
    tournamentId,
  ]);
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload_json), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}
