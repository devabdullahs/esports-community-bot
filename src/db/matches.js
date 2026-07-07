import { all, get, run, transaction } from './client.js';
import { normalizeTeamName } from '../lib/render.js';
import { EWC_TOURNAMENT_SQL } from './tournamentStandings.js';

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
    const structural = /:(?:matchlist|bracket):/i.test(m.external_id || '') ? 10 : 0;
    const liveWidgetFallback = /^[^:]+:\d+:/i.test(m.external_id || '') ? -10 : 0;
    return (
      status +
      stableMatchId +
      structural +
      liveWidgetFallback +
      (hasScore ? 20 : 0) +
      (m.logo_a ? 1 : 0) +
      (m.logo_b ? 1 : 0)
    );
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
  const exact = rows.filter((r) => keep.has(r));

  const byTime = new Map();
  for (const row of exact) {
    if (!row.scheduled_at) continue;
    const key = `${row.tournament_id ?? ''}|${row.game ?? ''}|${row.scheduled_at}`;
    const group = byTime.get(key);
    if (group) group.push(row);
    else byTime.set(key, [row]);
  }

  const drop = new Set();
  const teamKeys = (m) => [normalizeTeamName(m.team_a), normalizeTeamName(m.team_b)].filter(Boolean);
  for (const group of byTime.values()) {
    if (group.length < 2) continue;
    const chosen = [];
    for (const row of [...group].sort((a, b) => rank(b) - rank(a))) {
      const keys = new Set(teamKeys(row));
      const duplicate = chosen.some((kept) => teamKeys(kept).some((key) => keys.has(key)));
      if (duplicate) drop.add(row);
      else chosen.push(row);
    }
  }

  return exact.filter((r) => !drop.has(r));
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

// Live widgets can use redirected short names before the stable match row resolves
// (for example PTime -> PlayTime). Once a single stable, scored result exists for
// the same normalized pair/day, retire older timestamp-keyed alias rows immediately
// so they do not stay live while waiting for the next Liquipedia fetch.
export async function deleteResolvedLiveAliasMatches() {
  const rows = await all(
    `SELECT id, tournament_id, source, external_id, team_a, team_b, score_a, score_b, status, scheduled_at
     FROM matches
     WHERE source = 'liquipedia'
       AND scheduled_at IS NOT NULL
       AND (
         (status = 'finished' AND score_a IS NOT NULL AND score_b IS NOT NULL)
         OR status IN ('scheduled','running')
       )`,
  );
  const liveWidgetFallback = (r) => /^[^:]+:\d+:/i.test(String(r.external_id ?? ''));
  const normalizedDayKeyOf = (r) => {
    const pair = [normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|');
    return `${r.tournament_id}|${pair}|${Math.floor(Number(r.scheduled_at) / 86400)}`;
  };
  const rawPairKeyOf = (r) =>
    [r.team_a, r.team_b]
      .map((value) =>
        String(value ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase(),
      )
      .sort()
      .join('|');

  const canonicalByDay = new Map();
  for (const r of rows) {
    if (liveWidgetFallback(r) || r.status !== 'finished' || r.score_a == null || r.score_b == null) continue;
    const key = normalizedDayKeyOf(r);
    const bucket = canonicalByDay.get(key);
    if (bucket) bucket.push(r);
    else canonicalByDay.set(key, [r]);
  }

  const ids = [];
  for (const r of rows) {
    if (!liveWidgetFallback(r) || !['scheduled', 'running'].includes(r.status)) continue;
    const candidates = canonicalByDay.get(normalizedDayKeyOf(r)) || [];
    if (candidates.length !== 1) continue;
    const canonical = candidates[0];
    if (rawPairKeyOf(r) === rawPairKeyOf(canonical)) continue;
    if (Number(r.scheduled_at) <= Number(canonical.scheduled_at)) ids.push(r.id);
  }
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
      if (/^.+:br-schedule:/i.test(String(row.external_id ?? ''))) {
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

// Remove redundant duplicate rows within a tournament. A page can render the SAME
// match in two widgets (e.g. a bracket AND a match list), so it lands under two
// external ids that collapse to one on reads. Once a fetch settles on one canonical
// id for the same pair at the same exact start time, any sibling row in that group
// but absent from the current set is a stale duplicate and safe to drop. A group
// with NO current row is left untouched (it may be a transient parse gap), and
// untimed rows are skipped because same-pair rematches cannot be separated safely.
// Timestamp-keyed live-widget aliases are also retired when an already-finished
// current scored row covers the same normalized pair/day at or after that widget
// time, which clears stale redirect aliases like PTime -> PlayTime without
// deleting a later same-day rematch.
export async function deleteTournamentDuplicateMatches(tournamentId, currentExternalIds) {
  if (!currentExternalIds || !currentExternalIds.length) return 0;
  const current = new Set(currentExternalIds);
  const rows = await all(
    'SELECT id, external_id, team_a, team_b, score_a, score_b, status, scheduled_at FROM matches WHERE tournament_id = $1',
    [tournamentId],
  );
  const liveWidgetFallback = (r) => /^[^:]+:\d+:/i.test(String(r.external_id ?? ''));
  const keyOf = (r) => {
    if (!r.scheduled_at) return null;
    return `${[normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|')}|${r.scheduled_at}`;
  };
  const dayKeyOf = (r) => {
    if (!r.scheduled_at) return null;
    const pair = [normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|');
    return `${pair}|${Math.floor(Number(r.scheduled_at) / 86400)}`;
  };
  const groups = new Map(); // key -> { hasCurrent, staleIds: [] }
  const currentScoredByDay = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    if (key) {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { hasCurrent: false, staleIds: [] }));
      if (current.has(r.external_id)) g.hasCurrent = true;
      else g.staleIds.push(r.id);
    }

    const dayKey = dayKeyOf(r);
    const hasScoredResult = r.status === 'finished' && r.score_a != null && r.score_b != null;
    if (dayKey && current.has(r.external_id) && hasScoredResult) {
      const bucket = currentScoredByDay.get(dayKey);
      if (bucket) bucket.push(r);
      else currentScoredByDay.set(dayKey, [r]);
    }
  }
  const ids = new Set();
  for (const g of groups.values()) if (g.hasCurrent) for (const id of g.staleIds) ids.add(id);
  for (const r of rows) {
    if (current.has(r.external_id) || !liveWidgetFallback(r)) continue;
    const candidates = currentScoredByDay.get(dayKeyOf(r)) || [];
    if (candidates.length !== 1) continue;
    if (Number(r.scheduled_at) <= Number(candidates[0].scheduled_at)) ids.add(r.id);
  }
  if (!ids.size) return 0;
  await transaction(async (tx) => {
    for (const id of ids) await tx.run('DELETE FROM matches WHERE id = $1', [id]);
  });
  return ids.size;
}

// Distinct team names appearing in ACTIVE tournaments' matches for one game -
// the Liquipedia enrichment job's target set (its scope is always the tracked
// scene, never a wiki-wide crawl).
export async function listTrackedTeamNamesForGame(game, { ewcOnly = false } = {}) {
  // Same EWC scoping as listStandingsTeamNamesForGame (see EWC_TOURNAMENT_SQL there).
  const ewcSql = ewcOnly ? `AND ${EWC_TOURNAMENT_SQL}` : '';
  const rows = await all(
    `SELECT DISTINCT name FROM (
       SELECT m.team_a AS name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_a IS NOT NULL AND m.team_a <> '' ${ewcSql}
       UNION
       SELECT m.team_b AS name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_b IS NOT NULL AND m.team_b <> '' ${ewcSql}
      ) AS names
      ORDER BY name ASC`,
    [game],
  );
  return rows.map((row) => row.name);
}

// game -> soonest upcoming match time (unix seconds) across active tournaments.
// `sinceSec` should sit a few hours in the past so a LIVE event still counts as
// "now". Games with no upcoming scheduled match are absent. Drives the
// enrichment job's nearest-event-first ordering: the game whose tournament
// plays next gets the budget first.
export async function listGameNextMatchAt(sinceSec) {
  return all(
    `SELECT t.game AS game, MIN(m.scheduled_at) AS next_at
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
      WHERE t.active = 1 AND t.archived_at IS NULL
        AND m.scheduled_at IS NOT NULL AND m.scheduled_at >= $1
      GROUP BY t.game`,
    [sinceSec],
  );
}

// Match team rows WITH their tournament's identity, for the EWC weekly-pick
// scoping's JS-side event filtering (see listStandingsTeamRowsForGame).
export async function listTrackedTeamRowsForGame(game, { ewcOnly = false } = {}) {
  const ewcSql = ewcOnly ? `AND ${EWC_TOURNAMENT_SQL}` : '';
  return all(
    `SELECT DISTINCT team, tournament_path, tournament_name FROM (
       SELECT m.team_a AS team, t.external_id AS tournament_path, t.name AS tournament_name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_a IS NOT NULL AND m.team_a <> '' ${ewcSql}
       UNION
       SELECT m.team_b AS team, t.external_id AS tournament_path, t.name AS tournament_name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_b IS NOT NULL AND m.team_b <> '' ${ewcSql}
      ) AS names
      ORDER BY team ASC`,
    [game],
  );
}
