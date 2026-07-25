import { get, all, run, transaction, isPostgres } from './client.js';

function canonicalTournamentUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

const TOURNAMENT_SOURCE_SUPERSESSIONS = [
  {
    game: 'easportsfc',
    supersededSource: 'liquipedia',
    supersededUrl: 'https://liquipedia.net/easportsfc/FC_Pro_26/Play-Ins',
    canonicalSource: 'startgg',
    canonicalUrl:
      'https://start.gg/tournament/fc-pro-last-chance-qualifier-at-2026-esports-world-cup/event/fc-pro-last-chance-qualifier-at-2026-esports-world-cup',
  },
];

function sourceSupersessionFor(row) {
  const url = canonicalTournamentUrl(row?.url);
  return TOURNAMENT_SOURCE_SUPERSESSIONS.find(
    (rule) =>
      row?.game === rule.game &&
      row?.source === rule.supersededSource &&
      url === canonicalTournamentUrl(rule.supersededUrl),
  );
}

// Insert (or re-activate) a tracked tournament. Returns the stored row.
export async function addTournament(row) {
  const merged = {
    game: null,
    name: null,
    url: null,
    added_by: null,
    ...row,
  };
  return get(
    `INSERT INTO tournaments
       (source, external_id, game, name, url, guild_id, added_by, lifecycle_generation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
     ON CONFLICT (source, external_id, guild_id) DO UPDATE SET
       game = excluded.game,
       name = excluded.name,
       url  = excluded.url,
       active = 1,
       archived_at = NULL,
       lifecycle_generation = tournaments.lifecycle_generation + 1
     RETURNING *`,
    [merged.source, merged.external_id, merged.game, merged.name, merged.url, merged.guild_id, merged.added_by],
  );
}

export async function listActiveTournaments(guildId) {
  return guildId
    ? all('SELECT * FROM tournaments WHERE active = 1 AND archived_at IS NULL AND guild_id = $1 ORDER BY created_at DESC', [guildId])
    : all('SELECT * FROM tournaments WHERE active = 1 AND archived_at IS NULL ORDER BY created_at DESC');
}

// Bounded, guild-scoped local autocomplete source. The command layer still
// re-resolves an id before writing, so this only improves discovery latency.
export async function searchActiveTournaments(guildId, { q = '', limit = 50 } = {}) {
  if (!guildId) return [];
  const text = String(q || '').trim().toLowerCase();
  const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const params = [guildId];
  let where = 'active = 1 AND archived_at IS NULL AND guild_id = $1';
  if (text) {
    params.push(`%${text}%`);
    where += ` AND (lower(name) LIKE $2 OR lower(external_id) LIKE $2 OR lower(game) LIKE $2)`;
  }
  params.push(cappedLimit);
  return all(
    `SELECT * FROM tournaments
     WHERE ${where}
     ORDER BY lower(name) ASC, id ASC
     LIMIT $${params.length}`,
    params,
  );
}

export async function listEwcTournamentsForGame(guildId, game) {
  return all(
    `SELECT id, source, game, name, url, archived_at
     FROM tournaments
     WHERE guild_id = $1
       AND game = $2
       AND active = 1
       AND (
         ewc = 1
         OR LOWER(COALESCE(name, '')) LIKE '%esports world cup%'
         OR LOWER(COALESCE(url, '')) LIKE '%esports_world_cup%'
       )
       AND url IS NOT NULL
       AND url <> ''
     ORDER BY CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END, id DESC`,
    [guildId, game],
  );
}

// A broad Start.gg id can coexist with a later event-scoped id even though
// both resolve to the same event URL. Keep the copy with current activity and
// archive aliases so historical results remain available without duplicate cards.
export async function archiveDuplicateTournamentUrls(archivedAt = Math.floor(Date.now() / 1000)) {
  return transaction(async (tx) => {
    const rows = await tx.all(
      `SELECT t.id, t.source, t.guild_id, t.url,
              SUM(CASE WHEN m.status IN ('running', 'scheduled') THEN 1 ELSE 0 END) AS current_matches,
              COUNT(m.id) AS total_matches
       FROM tournaments t
       LEFT JOIN matches m ON m.tournament_id = t.id
       WHERE t.active = 1 AND t.archived_at IS NULL AND t.url IS NOT NULL AND t.url <> ''
       GROUP BY t.id, t.source, t.guild_id, t.url`,
    );
    const groups = new Map();
    for (const row of rows) {
      const url = canonicalTournamentUrl(row.url);
      if (!url) continue;
      const key = `${row.guild_id}|${row.source}|${url}`;
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }

    let archived = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) =>
        Number(b.current_matches || 0) - Number(a.current_matches || 0) ||
        Number(b.total_matches || 0) - Number(a.total_matches || 0) ||
        Number(b.id) - Number(a.id),
      );
      for (const duplicate of group.slice(1)) {
        const result = await tx.run(
          `UPDATE tournaments SET archived_at = $1
           WHERE id = $2 AND active = 1 AND archived_at IS NULL`,
          [archivedAt, duplicate.id],
        );
        archived += result.changes || result.rowCount || 0;
      }
    }
    return archived;
  });
}

// Some organizers publish a live bracket on start.gg while Liquipedia mirrors
// the same event more slowly. These exact event pairs are intentionally narrow:
// never infer cross-source aliases from names, because later finals can share a
// tournament family without being the same competition.
export async function archiveSupersededTournamentSources(archivedAt = Math.floor(Date.now() / 1000)) {
  return transaction(async (tx) => {
    const rows = await tx.all(
      `SELECT id, source, game, url, guild_id
       FROM tournaments
       WHERE active = 1 AND archived_at IS NULL`,
    );
    let archived = 0;
    for (const duplicate of rows) {
      const rule = sourceSupersessionFor(duplicate);
      if (!rule) continue;
      const canonical = rows.find(
        (candidate) =>
          candidate.guild_id === duplicate.guild_id &&
          candidate.game === rule.game &&
          candidate.source === rule.canonicalSource &&
          canonicalTournamentUrl(candidate.url) === canonicalTournamentUrl(rule.canonicalUrl),
      );
      if (!canonical) continue;
      const result = await tx.run(
        `UPDATE tournaments SET archived_at = $1
         WHERE id = $2 AND active = 1 AND archived_at IS NULL`,
        [archivedAt, duplicate.id],
      );
      archived += result.changes || result.rowCount || 0;
    }
    return archived;
  });
}

export async function resolveCanonicalTournamentId(id) {
  const tournament = await get('SELECT id, source, game, url, guild_id FROM tournaments WHERE id = $1', [id]);
  const rule = sourceSupersessionFor(tournament);
  if (!rule) return id;
  const candidates = await all(
    `SELECT id, url
     FROM tournaments
     WHERE guild_id = $1 AND game = $2 AND source = $3 AND active = 1
     ORDER BY CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END, id DESC`,
    [tournament.guild_id, rule.game, rule.canonicalSource],
  );
  const canonical = candidates.find(
    (candidate) => canonicalTournamentUrl(candidate.url) === canonicalTournamentUrl(rule.canonicalUrl),
  );
  return canonical?.id ?? id;
}

export async function getTournamentById(id) {
  return get('SELECT * FROM tournaments WHERE id = $1', [id]);
}

export async function getTournamentLifecycle(id) {
  return get(
    `SELECT id, guild_id, active, archived_at, lifecycle_generation
     FROM tournaments
     WHERE id = $1`,
    [id],
  );
}

export async function getActiveTournamentGeneration(id, guildId = null) {
  const params = [id];
  const guildClause = guildId == null ? '' : ` AND guild_id = $${params.push(String(guildId))}`;
  return get(
    `SELECT id, guild_id, lifecycle_generation
     FROM tournaments
     WHERE id = $1 AND active = 1 AND archived_at IS NULL${guildClause}`,
    params,
  );
}

export async function isTournamentGenerationActive(id, generation) {
  const row = await get(
    `SELECT 1 AS active
     FROM tournaments
     WHERE id = $1 AND active = 1 AND archived_at IS NULL
       AND lifecycle_generation = $2`,
    [id, generation],
  );
  return Boolean(row);
}

export async function withActiveTournamentGeneration(id, generation, callback) {
  return transaction(async (tx) => {
    const lock = isPostgres() ? ' FOR UPDATE' : '';
    const row = await tx.get(
      `SELECT *
       FROM tournaments
       WHERE id = $1 AND active = 1 AND archived_at IS NULL
         AND lifecycle_generation = $2${lock}`,
      [id, generation],
    );
    if (!row) return { applied: false, reason: 'stale_generation', value: null };
    return { applied: true, reason: null, value: await callback(tx, row) };
  });
}

export async function dispatchWithActiveTournamentGeneration(id, generation, dispatch) {
  const admission = await transaction(async (tx) => {
    const lock = isPostgres() ? ' FOR UPDATE' : '';
    const row = await tx.get(
      `SELECT id
       FROM tournaments
       WHERE id = $1 AND active = 1 AND archived_at IS NULL
         AND lifecycle_generation = $2${lock}`,
      [id, generation],
    );
    if (!row) return { applied: false, reason: 'stale_generation', request: null };

    // Start the request while the lifecycle row is locked, but do not hold the
    // transaction open for the network response.
    const request = Promise.resolve(dispatch());
    request.catch(() => {});
    return { applied: true, reason: null, request };
  });

  if (!admission.applied) {
    return { applied: false, reason: admission.reason, value: null };
  }
  return { applied: true, reason: null, value: await admission.request };
}

export async function updateTournamentName(id, name) {
  return run('UPDATE tournaments SET name = $1 WHERE id = $2', [name, id]);
}

export async function updateTournamentGame(id, game) {
  return run('UPDATE tournaments SET game = $1 WHERE id = $2', [game, id]);
}

export async function updateTournamentEwc(id, ewc) {
  return run('UPDATE tournaments SET ewc = $1 WHERE id = $2', [ewc ? 1 : 0, id]);
}

export async function deactivateTournament(id, guildId) {
  return get(
    `UPDATE tournaments
     SET active = 0,
         lifecycle_generation = lifecycle_generation + 1
     WHERE id = $1 AND guild_id = $2 AND active = 1
     RETURNING *`,
    [id, guildId],
  );
}

export async function archiveTournament(id, guildId, archivedAt = Math.floor(Date.now() / 1000)) {
  return get(
    `UPDATE tournaments
     SET active = 0,
         archived_at = $1,
         lifecycle_generation = lifecycle_generation + 1
     WHERE id = $2 AND guild_id = $3
       AND (active = 1 OR archived_at IS NULL)
     RETURNING *`,
    [archivedAt, id, guildId],
  );
}

export async function reactivateTournament(id, guildId) {
  return get(
    `UPDATE tournaments
     SET active = 1,
         archived_at = NULL,
         lifecycle_generation = lifecycle_generation + 1
     WHERE id = $1 AND guild_id = $2
       AND (active = 0 OR archived_at IS NOT NULL)
     RETURNING *`,
    [id, guildId],
  );
}

/**
 * @param {number} id
 * @param {string} guildId
 * @param {{ displayName?: string | null, game?: string | null, ewc?: boolean | null }} [overrides]
 */
export async function updateTournamentOverrides(
  id,
  guildId,
  { displayName = null, game = null, ewc = null } = {},
) {
  return get(
    `UPDATE tournaments
     SET display_name_override = $1,
         game_override = $2,
         ewc_override = $3
     WHERE id = $4 AND guild_id = $5
     RETURNING *`,
    [
      displayName == null ? null : String(displayName).trim().slice(0, 180) || null,
      game == null ? null : String(game).trim().slice(0, 80) || null,
      ewc == null ? null : ewc ? 1 : 0,
      id,
      guildId,
    ],
  );
}

/**
 * @param {{ guildId?: string | null, limit?: number }} [options]
 */
export async function listTournamentRegistry({ guildId, limit = 250 } = {}) {
  const params = [];
  const guildClause = guildId == null ? '' : `WHERE t.guild_id = $${params.push(String(guildId))}`;
  params.push(Math.max(1, Math.min(500, Number(limit) || 250)));
  return all(
    `SELECT t.*,
            COALESCE(t.display_name_override, t.name, t.external_id) AS effective_name,
            COALESCE(t.game_override, t.game) AS effective_game,
            COALESCE(t.ewc_override, t.ewc) AS effective_ewc,
            COALESCE(mc.running_count, 0) AS running_count,
            COALESCE(mc.scheduled_count, 0) AS scheduled_count,
            COALESCE(mc.finished_count, 0) AS finished_count
     FROM tournaments t
     LEFT JOIN (
       SELECT tournament_id,
              SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count,
              SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
              SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished_count
       FROM matches
       GROUP BY tournament_id
     ) mc ON mc.tournament_id = t.id
     ${guildClause}
     ORDER BY t.active DESC, t.archived_at IS NULL DESC, t.id DESC
     LIMIT $${params.length}`,
    params,
  );
}

function archivedTournamentWhere(
  guildId,
  { ewcOnly = false, game = '', source = '', query = '', status = 'all' } = {},
) {
  const clauses = ['a.guild_id = $1', 'a.archived_at IS NOT NULL'];
  const params = [guildId];
  const add = (clause, value) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };

  if (ewcOnly) {
    clauses.push(`(
      a.ewc = 1
      OR LOWER(COALESCE(a.name, '')) LIKE '%esports world cup%'
      OR LOWER(COALESCE(a.url, '')) LIKE '%esports_world_cup%'
    )`);
  }
  if (game) add('a.game = ?', String(game));
  if (source) add('a.source = ?', String(source));
  if (query) add(
    `(LOWER(COALESCE(a.name, '')) LIKE ?
      OR LOWER(COALESCE(a.game, '')) LIKE ?
      OR LOWER(COALESCE(a.source, '')) LIKE ?)`,
    `%${String(query).trim().toLowerCase()}%`,
  );
  // The same parameter is intentionally reused for all text fields.
  if (query) {
    const placeholder = `$${params.length}`;
    clauses[clauses.length - 1] = clauses[clauses.length - 1].replaceAll('?', placeholder);
  }

  if (status === 'live') clauses.push('a.running_count > 0');
  if (status === 'upcoming') clauses.push('a.running_count = 0 AND a.scheduled_count > 0');
  if (status === 'results') {
    clauses.push('a.running_count = 0 AND a.scheduled_count = 0 AND a.finished_count > 0');
  }
  return { where: clauses.join(' AND '), params };
}

const ARCHIVED_TOURNAMENTS_CTE = `WITH archived_tournaments AS (
  SELECT t.*, lm.last_match_at,
         COALESCE(lm.running_count, 0) AS running_count,
         COALESCE(lm.scheduled_count, 0) AS scheduled_count,
         COALESCE(lm.finished_count, 0) AS finished_count,
         COALESCE(lm.postponed_count, 0) AS postponed_count,
         COALESCE(lm.cancelled_count, 0) AS cancelled_count
  FROM tournaments t
  LEFT JOIN (
    SELECT tournament_id,
           MAX(scheduled_at) AS last_match_at,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
           SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished_count,
           SUM(CASE WHEN status = 'postponed' THEN 1 ELSE 0 END) AS postponed_count,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
    FROM matches
    WHERE NOT (source = 'startgg' AND external_id LIKE 'sgg:preview_%')
    GROUP BY tournament_id
  ) lm ON lm.tournament_id = t.id
)`;

export async function listArchivedTournamentFacets(guildId) {
  return all(
    `${ARCHIVED_TOURNAMENTS_CTE}
     SELECT id, name, game, source, url, ewc, archived_at, last_match_at,
            running_count, scheduled_count, finished_count, postponed_count, cancelled_count
     FROM archived_tournaments a
     WHERE a.guild_id = $1 AND a.archived_at IS NOT NULL
     ORDER BY COALESCE(a.last_match_at, a.archived_at) DESC, a.id DESC`,
    [guildId],
  );
}

export async function listArchivedTournaments(
  guildId,
  {
    limit = 25,
    offset = 0,
    ewcOnly = false,
    game = '',
    source = '',
    query = '',
    status = 'all',
  } = {},
) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const filters = archivedTournamentWhere(guildId, {
    ewcOnly,
    game,
    source,
    query: String(query).slice(0, 120),
    status,
  });
  filters.params.push(safeLimit, safeOffset);
  const limitPlaceholder = `$${filters.params.length - 1}`;
  const offsetPlaceholder = `$${filters.params.length}`;
  return all(
    `${ARCHIVED_TOURNAMENTS_CTE}
     SELECT a.*
     FROM archived_tournaments a
     WHERE ${filters.where}
     ORDER BY COALESCE(a.last_match_at, a.archived_at) DESC,
              a.archived_at DESC,
              a.id DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    filters.params,
  );
}

// Active tournaments that have ended: at least one match, EVERY match finished
// (no running, scheduled, or TBD), and the last match started more than
// `staleSeconds` ago. Used by the morning sweep to archive dead events.
export async function listEndedTournaments(staleSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - staleSeconds;
  return all(
    `SELECT t.id, t.guild_id, t.name
     FROM tournaments t
     JOIN matches m ON m.tournament_id = t.id
     WHERE t.active = 1
       AND t.archived_at IS NULL
       AND NOT (m.source = 'startgg' AND m.external_id LIKE 'sgg:preview_%')
     GROUP BY t.id, t.guild_id, t.name
     HAVING SUM(CASE WHEN m.status <> 'finished' THEN 1 ELSE 0 END) = 0
        AND MAX(m.scheduled_at) IS NOT NULL
        AND MAX(m.scheduled_at) < $1`,
    [cutoff],
  );
}
