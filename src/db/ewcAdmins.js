import { db } from './index.js';

export function getEwcAdminGameScopes(discordId) {
  return db
    .prepare('SELECT game_slug FROM ewc_admin_game_scopes WHERE discord_id = ? ORDER BY game_slug')
    .all(discordId)
    .map((row) => row.game_slug);
}

export function getEwcAdminMediaScopes(discordId) {
  return db
    .prepare('SELECT media_slug FROM ewc_admin_media_scopes WHERE discord_id = ? ORDER BY media_slug')
    .all(discordId)
    .map((row) => row.media_slug);
}

function hydrate(row) {
  if (!row) return null;
  return {
    discordId: row.discord_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    games: getEwcAdminGameScopes(row.discord_id),
    media: getEwcAdminMediaScopes(row.discord_id),
  };
}

export function getEwcAdmin(discordId) {
  return hydrate(db.prepare('SELECT * FROM ewc_admins WHERE discord_id = ?').get(discordId));
}

export function listEwcAdmins() {
  return db
    .prepare('SELECT * FROM ewc_admins ORDER BY display_name COLLATE NOCASE, discord_id')
    .all()
    .map(hydrate);
}

export function upsertEwcAdmin({ discordId, displayName = '' }) {
  db.prepare(
    `INSERT INTO ewc_admins (discord_id, display_name, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (discord_id) DO UPDATE SET display_name = excluded.display_name`,
  ).run(discordId, displayName);
  return getEwcAdmin(discordId);
}

export function setEwcAdminGameScopes(discordId, slugs) {
  const del = db.prepare('DELETE FROM ewc_admin_game_scopes WHERE discord_id = ?');
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ewc_admin_game_scopes (discord_id, game_slug) VALUES (?, ?)',
  );
  const tx = db.transaction((id, list) => {
    del.run(id);
    for (const slug of list) ins.run(id, slug);
  });
  tx(discordId, slugs);
}

export function setEwcAdminMediaScopes(discordId, slugs) {
  const del = db.prepare('DELETE FROM ewc_admin_media_scopes WHERE discord_id = ?');
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ewc_admin_media_scopes (discord_id, media_slug) VALUES (?, ?)',
  );
  const tx = db.transaction((id, list) => {
    del.run(id);
    for (const slug of list) ins.run(id, slug);
  });
  tx(discordId, slugs);
}

export function deleteEwcAdmin(discordId) {
  const tx = db.transaction((id) => {
    db.prepare('DELETE FROM ewc_admin_game_scopes WHERE discord_id = ?').run(id);
    db.prepare('DELETE FROM ewc_admin_media_scopes WHERE discord_id = ?').run(id);
    const result = db.prepare('DELETE FROM ewc_admins WHERE discord_id = ?').run(id);
    return { deleted: result.changes };
  });
  return tx(discordId);
}

// Clears scope rows pointing at a now-deleted game (called from deleteEwcGame).
export function clearGameScope(gameSlug) {
  db.prepare('DELETE FROM ewc_admin_game_scopes WHERE game_slug = ?').run(gameSlug);
}
