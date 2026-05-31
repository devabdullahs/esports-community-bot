import { db } from './index.js';

const upsert = db.prepare(`
  INSERT INTO matches
    (tournament_id, source, external_id, name, team_a, team_b, score_a, score_b, status, scheduled_at, last_polled_at, updated_at)
  VALUES
    (@tournament_id, @source, @external_id, @name, @team_a, @team_b, @score_a, @score_b, @status, @scheduled_at, datetime('now'), datetime('now'))
  ON CONFLICT (source, external_id) DO UPDATE SET
    tournament_id = excluded.tournament_id,
    name          = excluded.name,
    team_a        = excluded.team_a,
    team_b        = excluded.team_b,
    score_a       = excluded.score_a,
    score_b       = excluded.score_b,
    status        = excluded.status,
    scheduled_at  = excluded.scheduled_at,
    last_polled_at = datetime('now'),
    updated_at    = datetime('now')
  RETURNING *
`);

export function upsertMatch(row) {
  return upsert.get({
    name: null,
    team_a: 'TBD',
    team_b: 'TBD',
    score_a: null,
    score_b: null,
    scheduled_at: null,
    ...row,
  });
}

// Map a parser result (camelCase) into a DB row (snake_case).
export function toMatchRow(parsed, tournamentId) {
  return {
    tournament_id: tournamentId,
    source: parsed.source,
    external_id: parsed.externalId,
    name: parsed.name ?? `${parsed.teamA} vs ${parsed.teamB}`,
    team_a: parsed.teamA,
    team_b: parsed.teamB,
    score_a: parsed.scoreA ?? null,
    score_b: parsed.scoreB ?? null,
    status: parsed.status,
    scheduled_at: parsed.scheduledAt ?? null,
  };
}

export function getMatch(source, externalId) {
  return db.prepare('SELECT * FROM matches WHERE source = ? AND external_id = ?').get(source, externalId);
}

// All matches for a guild's active tournaments, with the tournament's game/name attached.
// Ordered: live first, then upcoming by start time, then finished.
export function getMatchesForGuild(guildId) {
  return db
    .prepare(
      `SELECT m.*, t.game AS game, t.name AS tournament_name,
              t.url AS tournament_url, t.external_id AS tournament_path, t.source AS tournament_source
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE t.guild_id = ? AND t.active = 1
       ORDER BY CASE m.status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
                m.scheduled_at ASC`,
    )
    .all(guildId);
}

// Matches that still need watching: pending or running, and not absurdly old.
export function getActiveMatches() {
  return db
    .prepare(
      `SELECT * FROM matches
       WHERE status IN ('scheduled','running')
         AND (scheduled_at IS NULL OR scheduled_at > strftime('%s','now') - 43200)`,
    )
    .all();
}

export function markFinished(id) {
  return db.prepare(`UPDATE matches SET status='finished', updated_at=datetime('now') WHERE id = ?`).run(id);
}
