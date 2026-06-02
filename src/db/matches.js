import { db } from './index.js';
import { normalizeTeamName } from '../lib/render.js';

const upsert = db.prepare(`
  INSERT INTO matches
    (tournament_id, source, external_id, name, team_a, team_b, logo_a, logo_b, score_a, score_b, status, scheduled_at, last_polled_at, updated_at)
  VALUES
    (@tournament_id, @source, @external_id, @name, @team_a, @team_b, @logo_a, @logo_b, @score_a, @score_b, @status, @scheduled_at, datetime('now'), datetime('now'))
  ON CONFLICT (source, external_id) DO UPDATE SET
    tournament_id = excluded.tournament_id,
    name          = excluded.name,
    team_a        = excluded.team_a,
    team_b        = excluded.team_b,
    logo_a        = COALESCE(excluded.logo_a, matches.logo_a),
    logo_b        = COALESCE(excluded.logo_b, matches.logo_b),
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
    logo_a: null,
    logo_b: null,
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
    logo_a: parsed.logoA ?? null,
    logo_b: parsed.logoB ?? null,
    score_a: parsed.scoreA ?? null,
    score_b: parsed.scoreB ?? null,
    status: parsed.status,
    scheduled_at: parsed.scheduledAt ?? null,
  };
}

export function getMatch(source, externalId) {
  return db.prepare('SELECT * FROM matches WHERE source = ? AND external_id = ?').get(source, externalId);
}

// Collapse rows that describe the SAME match but were stored separately — e.g. the bracket form
// "Team Canada" plus the upcoming-widget form "Canada", or the same game tracked on two sources.
// Keyed by game + normalized team pair + calendar day; keeps the most informative row
// (live > finished > scheduled, prefers one carrying a score and logos).
function dedupeMatches(rows) {
  const rank = (m) =>
    (m.status === 'running' ? 100 : m.status === 'finished' ? 50 : 0) +
    (m.score_a != null ? 10 : 0) +
    (m.logo_a ? 1 : 0) +
    (m.logo_b ? 1 : 0);
  const best = new Map();
  for (const m of rows) {
    const day = m.scheduled_at ? Math.floor(m.scheduled_at / 86400) : 'x';
    const pair = [normalizeTeamName(m.team_a), normalizeTeamName(m.team_b)].sort().join('|');
    const key = `${m.game}|${pair}|${day}`;
    const cur = best.get(key);
    if (!cur || rank(m) > rank(cur)) best.set(key, m);
  }
  const keep = new Set(best.values());
  return rows.filter((r) => keep.has(r));
}

// All matches for a guild's active tournaments, with the tournament's game/name attached.
// Ordered: live first, then upcoming by start time, then finished.
export function getMatchesForGuild(guildId) {
  const rows = db
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
  return dedupeMatches(rows);
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

export function deleteTournamentPlaceholderMatches(tournamentId) {
  const rows = db
    .prepare('SELECT id, team_a, team_b FROM matches WHERE tournament_id = ?')
    .all(tournamentId);
  const clean = (value) =>
    String(value ?? '')
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const isPlaceholder = (value) => {
    const text = clean(value);
    return !text || /^TBD$/i.test(text);
  };

  const ids = rows.filter((row) => isPlaceholder(row.team_a) && isPlaceholder(row.team_b)).map((row) => row.id);
  if (!ids.length) return 0;
  const del = db.prepare('DELETE FROM matches WHERE id = ?');
  const tx = db.transaction((toDelete) => {
    for (const id of toDelete) del.run(id);
  });
  tx(ids);
  return ids.length;
}
