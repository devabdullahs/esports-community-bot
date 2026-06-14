import { get, all, run } from './client.js';

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
       active = 1
     RETURNING *`,
    [merged.source, merged.external_id, merged.game, merged.name, merged.url, merged.guild_id, merged.added_by],
  );
}

export async function listActiveTournaments(guildId) {
  return guildId
    ? all('SELECT * FROM tournaments WHERE active = 1 AND guild_id = $1 ORDER BY created_at DESC', [guildId])
    : all('SELECT * FROM tournaments WHERE active = 1 ORDER BY created_at DESC');
}

export async function getTournamentById(id) {
  return get('SELECT * FROM tournaments WHERE id = $1', [id]);
}

export async function updateTournamentName(id, name) {
  return run('UPDATE tournaments SET name = $1 WHERE id = $2', [name, id]);
}

export async function deactivateTournament(id, guildId) {
  return run('UPDATE tournaments SET active = 0 WHERE id = $1 AND guild_id = $2', [id, guildId]);
}

// Active tournaments that have ended: at least one match, EVERY match finished
// (no running, scheduled, or TBD), and the last match started more than
// `staleSeconds` ago. Used by the morning sweep to auto-untrack dead events.
export async function listEndedTournaments(staleSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - staleSeconds;
  return all(
    `SELECT t.id, t.guild_id, t.name
     FROM tournaments t
     JOIN matches m ON m.tournament_id = t.id
     WHERE t.active = 1
     GROUP BY t.id, t.guild_id, t.name
     HAVING SUM(CASE WHEN m.status <> 'finished' THEN 1 ELSE 0 END) = 0
        AND MAX(m.scheduled_at) IS NOT NULL
        AND MAX(m.scheduled_at) < $1`,
    [cutoff],
  );
}
