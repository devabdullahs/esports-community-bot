import { all, get, run, transaction } from './client.js';
import { normalizeTeamName } from '../lib/render.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

const STARTGG_PREVIEW_MATCH_SQL = "(source = 'startgg' AND external_id LIKE 'sgg:preview_%')";
const STARTGG_PREVIEW_MATCH_SQL_M = "(m.source = 'startgg' AND m.external_id LIKE 'sgg:preview_%')";

export async function upsertMatch(row) {
  const merged = {
    name: null,
    team_a: 'TBD',
    team_b: 'TBD',
    logo_a: null,
    logo_b: null,
    score_a: null,
    score_b: null,
    scheduled_at: null,
    stream_platform: null,
    stream_url: null,
    ...row,
  };
  const now = nowText();
  return get(
    `INSERT INTO matches
       (tournament_id, source, external_id, name, team_a, team_b, logo_a, logo_b, score_a, score_b, status, scheduled_at, stream_platform, stream_url, last_polled_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
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
       stream_platform = excluded.stream_platform,
       stream_url      = excluded.stream_url,
       last_polled_at = $15,
       updated_at    = $15
     RETURNING *`,
    [
      merged.tournament_id,
      merged.source,
      merged.external_id,
      merged.name,
      merged.team_a,
      merged.team_b,
      merged.logo_a,
      merged.logo_b,
      merged.score_a,
      merged.score_b,
      merged.status,
      merged.scheduled_at,
      merged.stream_platform,
      merged.stream_url,
      now,
    ],
  );
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
    stream_platform: parsed.stream?.platform ?? null,
    stream_url: parsed.stream?.url ?? null,
  };
}

export async function getMatch(source, externalId) {
  return get('SELECT * FROM matches WHERE source = $1 AND external_id = $2', [source, externalId]);
}

// Collapse rows that describe the SAME match but were stored separately — e.g. the bracket form
// "Team Canada" plus the upcoming-widget form "Canada", or the same game tracked on two sources.
// Keyed by game + normalized team pair + calendar day; keeps the most authoritative row.
// A finished result with a score beats a stale "running" widget row for the same pair/day.
export function dedupeMatches(rows) {
  const rank = (m) => {
    const hasScore = m.score_a != null && m.score_b != null;
    const status =
      m.status === 'finished' && hasScore ? 300 : m.status === 'running' ? 200 : m.status === 'finished' ? 150 : 0;
    const stableMatchId = /^Match:/i.test(m.external_id || '') ? 40 : 0;
    return status + stableMatchId + (hasScore ? 20 : 0) + (m.logo_a ? 1 : 0) + (m.logo_b ? 1 : 0);
  };
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
export async function getMatchesForGuild(guildId) {
  const rows = await all(
    `SELECT m.*, t.game AS game, t.name AS tournament_name,
            t.url AS tournament_url, t.external_id AS tournament_path, t.source AS tournament_source
     FROM matches m
     JOIN tournaments t ON t.id = m.tournament_id
     WHERE t.guild_id = $1 AND t.active = 1
       AND t.archived_at IS NULL
       AND NOT ${STARTGG_PREVIEW_MATCH_SQL_M}
     ORDER BY CASE m.status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
              m.scheduled_at ASC`,
    [guildId],
  );
  return dedupeMatches(rows);
}

// Matches that still need watching: pending or running, and not absurdly old.
export async function getActiveMatches() {
  const cutoff = Math.floor(Date.now() / 1000) - 43200;
  return all(
    `SELECT m.*
     FROM matches m
     JOIN tournaments t ON t.id = m.tournament_id
     WHERE t.active = 1
       AND t.archived_at IS NULL
       AND m.status IN ('scheduled','running')
       AND (m.scheduled_at IS NULL OR m.scheduled_at > $1)
       AND NOT ${STARTGG_PREVIEW_MATCH_SQL_M}`,
    [cutoff],
  );
}

// Distinct crest URLs across active, non-archived tournaments' matches. The logo
// warmup job pre-downloads these into the shared on-disk cache so the web logo
// proxy (which never fetches upstream on public page views) can serve them.
export async function listTrackedMatchLogos() {
  const now = Math.floor(Date.now() / 1000);
  const recentCutoff = now - 7 * 24 * 60 * 60;
  const rows = await all(
    `SELECT logo
       FROM (
         SELECT logo, MIN(priority) AS priority, MIN(sort_at) AS sort_at
           FROM (
             SELECT m.logo_a AS logo,
                    CASE
                      WHEN m.status = 'running' THEN 0
                      WHEN m.status = 'scheduled' AND (m.scheduled_at IS NULL OR m.scheduled_at >= $1) THEN 1
                      WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at >= $2 THEN 2
                      ELSE 3
                    END AS priority,
                    COALESCE(m.scheduled_at, 2147483647) AS sort_at
               FROM matches m
               JOIN tournaments t ON t.id = m.tournament_id
              WHERE t.active = 1 AND t.archived_at IS NULL AND m.logo_a IS NOT NULL AND m.logo_a <> ''
             UNION ALL
             SELECT m.logo_b AS logo,
                    CASE
                      WHEN m.status = 'running' THEN 0
                      WHEN m.status = 'scheduled' AND (m.scheduled_at IS NULL OR m.scheduled_at >= $1) THEN 1
                      WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at >= $2 THEN 2
                      ELSE 3
                    END AS priority,
                    COALESCE(m.scheduled_at, 2147483647) AS sort_at
               FROM matches m
               JOIN tournaments t ON t.id = m.tournament_id
              WHERE t.active = 1 AND t.archived_at IS NULL AND m.logo_b IS NOT NULL AND m.logo_b <> ''
           ) AS logo_rows
          GROUP BY logo
       ) AS crests
      ORDER BY priority ASC, sort_at ASC, logo ASC`,
    [now, recentCutoff],
  );
  return rows.map((row) => row.logo).filter(Boolean);
}

export async function markFinished(id) {
  return run(`UPDATE matches SET status='finished', updated_at=$1 WHERE id = $2`, [nowText(), id]);
}

export async function markFinishedByExternalId(source, externalId) {
  return run(`UPDATE matches SET status='finished', updated_at=$1 WHERE source = $2 AND external_id = $3`, [
    nowText(),
    source,
    externalId,
  ]);
}

// If a source leaves an already-started match without a posted result, it can stay
// scheduled/running forever. Flip those stale active rows to finished so boards stop
// showing old matches as live or upcoming while the parser catches up.
export async function markStaleActiveFinished(staleSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - staleSeconds;
  const result = await run(
    `UPDATE matches SET status='finished', updated_at=$1
     WHERE status IN ('scheduled','running') AND scheduled_at IS NOT NULL AND scheduled_at < $2`,
    [nowText(), cutoff],
  );
  return result.changes || 0;
}

// Reschedule churn (an externalId once keyed on a shifting start time) can leave a
// finished match with no score — a phantom shadowing the real, correctly-scored row
// for the SAME pair in the SAME tournament. Retire those phantoms so they don't
// pollute results/counts. Only deletes a finished null-score row when a finished
// SCORED row exists for the same normalized team pair in the same tournament, so a
// genuinely-unresolved match (no scored twin) is always kept.
export async function deleteResolvedDuplicateMatches() {
  const rows = await all(
    `SELECT id, tournament_id, team_a, team_b, score_a, score_b
     FROM matches WHERE status = 'finished'`,
  );
  const pairKey = (r) =>
    `${r.tournament_id}|${[normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|')}`;
  const scoredPairs = new Set();
  for (const r of rows) {
    if (r.score_a != null && r.score_b != null) scoredPairs.add(pairKey(r));
  }
  const ids = rows
    .filter((r) => (r.score_a == null || r.score_b == null) && scoredPairs.has(pairKey(r)))
    .map((r) => r.id);
  if (!ids.length) return 0;
  await transaction(async (tx) => {
    for (const id of ids) await tx.run('DELETE FROM matches WHERE id = $1', [id]);
  });
  return ids.length;
}

export async function deleteTournamentPlaceholderMatches(tournamentId, currentExternalIds = null) {
  const rows = await all(
    'SELECT id, external_id, team_a, team_b, scheduled_at FROM matches WHERE tournament_id = $1',
    [tournamentId],
  );
  const current = currentExternalIds ? new Set(currentExternalIds) : null;
  const now = Math.floor(Date.now() / 1000);
  const staleAfterSeconds = 4 * 3600;
  const clean = (value) =>
    String(value ?? '')
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const isPlaceholder = (value) => {
    const text = clean(value);
    return !text || /^TBD$/i.test(text);
  };

  const ids = rows
    .filter((row) => {
      if (/^sgg:preview_/i.test(String(row.external_id ?? ''))) {
        return current && !current.has(row.external_id);
      }
      const placeholderA = isPlaceholder(row.team_a);
      const placeholderB = isPlaceholder(row.team_b);
      if (placeholderA && placeholderB) return true;
      if (!placeholderA && !placeholderB) return false;

      const missingFromLatest = current && !current.has(row.external_id);
      const overdue = row.scheduled_at && row.scheduled_at < now - staleAfterSeconds;
      return missingFromLatest || overdue;
    })
    .map((row) => row.id);
  if (!ids.length) return 0;
  await transaction(async (tx) => {
    for (const id of ids) await tx.run('DELETE FROM matches WHERE id = $1', [id]);
  });
  return ids.length;
}

// Distinct team names appearing in ACTIVE tournaments' matches for one game -
// the Liquipedia enrichment job's target set (its scope is always the tracked
// scene, never a wiki-wide crawl).
export async function listTrackedTeamNamesForGame(game) {
  const rows = await all(
    `SELECT DISTINCT name FROM (
       SELECT m.team_a AS name FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
        WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_a IS NOT NULL AND m.team_a <> ''
       UNION
       SELECT m.team_b AS name FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
        WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_b IS NOT NULL AND m.team_b <> ''
     ) AS names
     ORDER BY name ASC`,
    [game],
  );
  return rows.map((row) => row.name);
}
