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

export async function recordTournamentSyncSuccess({ tournamentId, source, itemCount: count, at = Date.now() / 1000 }) {
  const timestamp = unixSeconds(at);
  return run(
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

export async function recordTournamentSyncFailure({
  tournamentId,
  source,
  category,
  at = Date.now() / 1000,
}) {
  const timestamp = unixSeconds(at);
  return run(
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

export async function getTournamentSyncHealth(tournamentId) {
  return get('SELECT * FROM tournament_sync_health WHERE tournament_id = $1', [tournamentId]);
}

export async function listTournamentSyncHealth(tournamentIds) {
  const ids = [...new Set((tournamentIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  return all(`SELECT * FROM tournament_sync_health WHERE tournament_id IN (${placeholders})`, ids);
}

// Admin-only caller: include every active tournament so never-synced events can
// be surfaced as unavailable rather than disappearing from operations view.
export async function listActiveTournamentSyncHealth() {
  return all(
    `SELECT t.id AS tournament_id, t.name AS tournament_name, t.source AS tournament_source, t.url AS tournament_url,
            t.game AS tournament_game, t.archived_at,
            h.source, h.last_attempt_at, h.last_success_at, h.last_failure_at,
            h.last_failure_category, h.consecutive_failures, h.last_item_count, h.updated_at,
            EXISTS(
              SELECT 1 FROM matches m
              WHERE m.tournament_id = t.id AND m.status = 'running'
            ) AS has_running_match
       FROM tournaments t
       LEFT JOIN tournament_sync_health h ON h.tournament_id = t.id
      WHERE t.active = 1 AND t.archived_at IS NULL
      ORDER BY t.id ASC`,
    [],
  );
}
