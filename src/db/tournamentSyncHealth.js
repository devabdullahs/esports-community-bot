import { all, get, run } from './client.js';
import {
  normalizeTournamentSyncFailureCategory,
  normalizeTournamentSyncSource,
} from '../lib/tournamentSyncHealth.js';

function unixSeconds(value) {
  const seconds = Math.floor(Number(value));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : Math.floor(Date.now() / 1000);
}

function itemCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function sourceFor(value) {
  const source = normalizeTournamentSyncSource(value);
  if (!source) throw new Error('Tournament sync health requires a supported source.');
  return source;
}

function dataKindFor(value) {
  const kind = String(value || 'schedule').trim().toLowerCase();
  if (!['schedule', 'standings'].includes(kind)) throw new Error('Unsupported tournament health data kind.');
  return kind;
}

export async function recordTournamentSyncSuccess({
  tournamentId,
  source,
  itemCount: count,
  at = Date.now() / 1000,
  dataKind = 'schedule',
}) {
  const timestamp = unixSeconds(at);
  const kind = dataKindFor(dataKind);
  const result = await run(
    `INSERT INTO tournament_data_health
       (tournament_id, data_kind, source, supported, last_attempt_at, last_success_at,
        consecutive_failures, last_item_count, updated_at)
     VALUES ($1, $2, $3, 1, $4, $4, 0, $5, $4)
     ON CONFLICT(tournament_id, data_kind) DO UPDATE SET
       source = excluded.source,
       supported = 1,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       last_failure_category = NULL,
       consecutive_failures = 0,
       last_item_count = excluded.last_item_count,
       updated_at = excluded.updated_at`,
    [tournamentId, kind, sourceFor(source), timestamp, itemCount(count)],
  );
  if (kind === 'schedule') {
    await run(
      `INSERT INTO tournament_sync_health
       (tournament_id, source, last_attempt_at, last_success_at, consecutive_failures, last_item_count, updated_at)
     VALUES ($1, $2, $3, $3, 0, $4, $3)
     ON CONFLICT(tournament_id) DO UPDATE SET
       source = excluded.source,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       last_failure_category = NULL,
       consecutive_failures = 0,
       last_item_count = excluded.last_item_count,
       updated_at = excluded.updated_at`,
      [tournamentId, sourceFor(source), timestamp, itemCount(count)],
    );
  }
  return result;
}

export async function recordTournamentSyncFailure({
  tournamentId,
  source,
  category,
  at = Date.now() / 1000,
  dataKind = 'schedule',
}) {
  const timestamp = unixSeconds(at);
  const kind = dataKindFor(dataKind);
  const result = await run(
    `INSERT INTO tournament_data_health
       (tournament_id, data_kind, source, supported, last_attempt_at, last_failure_at,
        last_failure_category, consecutive_failures, updated_at)
     VALUES ($1, $2, $3, 1, $4, $4, $5, 1, $4)
     ON CONFLICT(tournament_id, data_kind) DO UPDATE SET
       source = excluded.source,
       supported = 1,
       last_attempt_at = excluded.last_attempt_at,
       last_failure_at = excluded.last_failure_at,
       last_failure_category = excluded.last_failure_category,
       consecutive_failures = tournament_data_health.consecutive_failures + 1,
       updated_at = excluded.updated_at`,
    [tournamentId, kind, sourceFor(source), timestamp, normalizeTournamentSyncFailureCategory(category)],
  );
  if (kind === 'schedule') {
    await run(
      `INSERT INTO tournament_sync_health
       (tournament_id, source, last_attempt_at, last_failure_at, last_failure_category, consecutive_failures, updated_at)
     VALUES ($1, $2, $3, $3, $4, 1, $3)
     ON CONFLICT(tournament_id) DO UPDATE SET
       source = excluded.source,
       last_attempt_at = excluded.last_attempt_at,
       last_failure_at = excluded.last_failure_at,
       last_failure_category = excluded.last_failure_category,
       consecutive_failures = tournament_sync_health.consecutive_failures + 1,
       updated_at = excluded.updated_at`,
      [tournamentId, sourceFor(source), timestamp, normalizeTournamentSyncFailureCategory(category)],
    );
  }
  return result;
}

export async function markTournamentDataKindUnsupported({
  tournamentId,
  source,
  dataKind,
  at = Date.now() / 1000,
}) {
  const timestamp = unixSeconds(at);
  return run(
    `INSERT INTO tournament_data_health
       (tournament_id, data_kind, source, supported, consecutive_failures, updated_at)
     VALUES ($1, $2, $3, 0, 0, $4)
     ON CONFLICT(tournament_id, data_kind) DO UPDATE SET
       source = excluded.source, supported = 0, consecutive_failures = 0,
       last_failure_category = NULL, updated_at = excluded.updated_at`,
    [tournamentId, dataKindFor(dataKind), sourceFor(source), timestamp],
  );
}

export async function getTournamentSyncHealth(tournamentId, dataKind = 'schedule') {
  const row = await get(
    'SELECT * FROM tournament_data_health WHERE tournament_id = $1 AND data_kind = $2',
    [tournamentId, dataKindFor(dataKind)],
  );
  if (row || dataKind !== 'schedule') return row;
  return get('SELECT *, $2 AS data_kind, 1 AS supported FROM tournament_sync_health WHERE tournament_id = $1', [
    tournamentId,
    'schedule',
  ]);
}

export async function listTournamentSyncHealth(tournamentIds, dataKind = null) {
  const ids = [...new Set((tournamentIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const params = [...ids];
  const kindClause = dataKind ? ` AND data_kind = $${params.push(dataKindFor(dataKind))}` : '';
  return all(`SELECT * FROM tournament_data_health WHERE tournament_id IN (${placeholders})${kindClause}`, params);
}

// Admin-only caller: include every active tournament so never-synced events can
// be surfaced as unavailable rather than disappearing from operations view.
export async function listActiveTournamentSyncHealth() {
  return all(
    `SELECT t.id AS tournament_id, t.name AS tournament_name, t.source AS tournament_source, t.url AS tournament_url,
            t.game AS tournament_game, t.archived_at,
            COALESCE(sh.source, t.source) AS source,
            sh.last_attempt_at, sh.last_success_at, sh.last_failure_at,
            sh.last_failure_category, sh.consecutive_failures, sh.last_item_count, sh.updated_at,
            sth.supported AS standings_supported,
            sth.last_attempt_at AS standings_last_attempt_at,
            sth.last_success_at AS standings_last_success_at,
            sth.last_failure_at AS standings_last_failure_at,
            sth.last_failure_category AS standings_last_failure_category,
            sth.consecutive_failures AS standings_consecutive_failures,
            sth.last_item_count AS standings_last_item_count,
            EXISTS(
              SELECT 1 FROM matches m
              WHERE m.tournament_id = t.id AND m.status = 'running'
            ) AS has_running_match
       FROM tournaments t
       LEFT JOIN tournament_data_health sh
         ON sh.tournament_id = t.id AND sh.data_kind = 'schedule'
       LEFT JOIN tournament_data_health sth
         ON sth.tournament_id = t.id AND sth.data_kind = 'standings'
      WHERE t.active = 1 AND t.archived_at IS NULL
      ORDER BY t.id ASC`,
    [],
  );
}
