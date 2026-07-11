import { get, all, run, transaction } from './client.js';

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
    `INSERT INTO tournaments (source, external_id, game, name, url, guild_id, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source, external_id, guild_id) DO UPDATE SET
       game = excluded.game,
       name = excluded.name,
       url  = excluded.url,
       active = 1,
       archived_at = NULL
     RETURNING *`,
    [merged.source, merged.external_id, merged.game, merged.name, merged.url, merged.guild_id, merged.added_by],
  );
}

export async function listActiveTournaments(guildId) {
  return guildId
    ? all('SELECT * FROM tournaments WHERE active = 1 AND archived_at IS NULL AND guild_id = $1 ORDER BY created_at DESC', [guildId])
    : all('SELECT * FROM tournaments WHERE active = 1 AND archived_at IS NULL ORDER BY created_at DESC');
}

export async function listEwcTournamentsForGame(guildId, game) {
  return all(
    `SELECT id, source, game, name, url, archived_at
     FROM tournaments
     WHERE guild_id = $1
       AND game = $2
       AND active = 1
       AND ewc = 1
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

export async function getTournamentById(id) {
  return get('SELECT * FROM tournaments WHERE id = $1', [id]);
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
  return run('UPDATE tournaments SET active = 0 WHERE id = $1 AND guild_id = $2', [id, guildId]);
}

export async function archiveTournament(id, guildId, archivedAt = Math.floor(Date.now() / 1000)) {
  return run(
    `UPDATE tournaments
     SET archived_at = $1
     WHERE id = $2 AND guild_id = $3 AND archived_at IS NULL`,
    [archivedAt, id, guildId],
  );
}

export async function listArchivedTournaments(guildId, { limit = 25, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return all(
    `SELECT t.*, lm.last_match_at
     FROM tournaments t
     LEFT JOIN (
       SELECT tournament_id, MAX(scheduled_at) AS last_match_at
       FROM matches
       WHERE NOT (source = 'startgg' AND external_id LIKE 'sgg:preview_%')
       GROUP BY tournament_id
     ) lm ON lm.tournament_id = t.id
     WHERE t.guild_id = $1 AND t.archived_at IS NOT NULL
     ORDER BY COALESCE(lm.last_match_at, t.archived_at) DESC,
              t.archived_at DESC,
              t.id DESC
     LIMIT $2 OFFSET $3`,
    [guildId, safeLimit, safeOffset],
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
