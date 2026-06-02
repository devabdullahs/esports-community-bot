import { db } from './index.js';

// Insert (or re-activate) a tracked tournament. Returns the stored row.
const upsert = db.prepare(`
  INSERT INTO tournaments (source, external_id, game, name, url, guild_id, added_by)
  VALUES (@source, @external_id, @game, @name, @url, @guild_id, @added_by)
  ON CONFLICT (source, external_id, guild_id) DO UPDATE SET
    game = excluded.game,
    name = excluded.name,
    url  = excluded.url,
    active = 1
  RETURNING *
`);

export function addTournament(row) {
  return upsert.get({
    game: null,
    name: null,
    url: null,
    added_by: null,
    ...row,
  });
}

export function listActiveTournaments(guildId) {
  return guildId
    ? db
        .prepare('SELECT * FROM tournaments WHERE active = 1 AND guild_id = ? ORDER BY created_at DESC')
        .all(guildId)
    : db.prepare('SELECT * FROM tournaments WHERE active = 1 ORDER BY created_at DESC').all();
}

export function getTournamentById(id) {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
}

export function updateTournamentName(id, name) {
  return db.prepare('UPDATE tournaments SET name = ? WHERE id = ?').run(name, id);
}

export function deactivateTournament(id, guildId) {
  return db.prepare('UPDATE tournaments SET active = 0 WHERE id = ? AND guild_id = ?').run(id, guildId);
}
