import { all, get, run, transaction } from './client.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function getEwcAdminGameScopes(discordId) {
  return (await all('SELECT game_slug FROM ewc_admin_game_scopes WHERE discord_id = $1 ORDER BY game_slug', [discordId])).map(
    (row) => row.game_slug,
  );
}

export async function getEwcAdminMediaScopes(discordId) {
  return (await all('SELECT media_slug FROM ewc_admin_media_scopes WHERE discord_id = $1 ORDER BY media_slug', [discordId])).map(
    (row) => row.media_slug,
  );
}

async function hydrate(row) {
  if (!row) return null;
  return {
    discordId: row.discord_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    games: await getEwcAdminGameScopes(row.discord_id),
    media: await getEwcAdminMediaScopes(row.discord_id),
  };
}

export async function getEwcAdmin(discordId) {
  return hydrate(await get('SELECT * FROM ewc_admins WHERE discord_id = $1', [discordId]));
}

export async function listEwcAdmins() {
  const rows = await all('SELECT * FROM ewc_admins ORDER BY LOWER(display_name), discord_id');
  return Promise.all(rows.map(hydrate));
}

export async function upsertEwcAdmin({ discordId, displayName = '' }) {
  await run(
    `INSERT INTO ewc_admins (discord_id, display_name, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (discord_id) DO UPDATE SET display_name = excluded.display_name`,
    [discordId, displayName, nowText()],
  );
  return getEwcAdmin(discordId);
}

export async function setEwcAdminGameScopes(discordId, slugs) {
  await transaction(async (tx) => {
    await tx.run('DELETE FROM ewc_admin_game_scopes WHERE discord_id = $1', [discordId]);
    for (const slug of slugs) {
      await tx.run(
        'INSERT INTO ewc_admin_game_scopes (discord_id, game_slug) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [discordId, slug],
      );
    }
  });
}

export async function setEwcAdminMediaScopes(discordId, slugs) {
  await transaction(async (tx) => {
    await tx.run('DELETE FROM ewc_admin_media_scopes WHERE discord_id = $1', [discordId]);
    for (const slug of slugs) {
      await tx.run(
        'INSERT INTO ewc_admin_media_scopes (discord_id, media_slug) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [discordId, slug],
      );
    }
  });
}

export async function deleteEwcAdmin(discordId) {
  return transaction(async (tx) => {
    await tx.run('DELETE FROM ewc_admin_game_scopes WHERE discord_id = $1', [discordId]);
    await tx.run('DELETE FROM ewc_admin_media_scopes WHERE discord_id = $1', [discordId]);
    const result = await tx.run('DELETE FROM ewc_admins WHERE discord_id = $1', [discordId]);
    return { deleted: result.changes };
  });
}

// Clears scope rows pointing at a now-deleted game (called from deleteEwcGame).
export async function clearGameScope(gameSlug) {
  return run('DELETE FROM ewc_admin_game_scopes WHERE game_slug = $1', [gameSlug]);
}
