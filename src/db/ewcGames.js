import { all, get, run, transaction } from './client.js';
import { DEFAULT_GAMES } from '../lib/defaultGames.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function hydrate(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    title: parseJson(row.title_json, { en: '', ar: '' }),
    description: parseJson(row.description_json, { en: '', ar: '' }),
    status: parseJson(row.status_json, { en: '', ar: '' }),
    owner: parseJson(row.owner_json, { en: '', ar: '' }),
    focus: parseJson(row.focus_json, []),
    discordChannelId: row.discord_channel_id || null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  const count = (await get('SELECT COUNT(*) AS c FROM ewc_games'))?.c || 0;
  if (count > 0) return;
  await transaction(async (tx) => {
    const now = nowText();
    for (const [index, game] of DEFAULT_GAMES.entries()) {
      await tx.run(
        `INSERT INTO ewc_games
           (slug, title_json, description_json, status_json, owner_json, focus_json, sort_order,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO NOTHING`,
        [
          game.slug,
          JSON.stringify(game.title),
          JSON.stringify(game.description),
          JSON.stringify(game.status),
          JSON.stringify(game.owner),
          JSON.stringify(game.focus || []),
          index,
          now,
          now,
        ],
      );
    }
  });
}

export async function listEwcGames() {
  await ensureSeeded();
  return (await all('SELECT * FROM ewc_games ORDER BY sort_order ASC, slug ASC')).map(hydrate);
}

export async function getEwcGame(slug) {
  await ensureSeeded();
  return hydrate(await get('SELECT * FROM ewc_games WHERE slug = $1', [slug]));
}

async function nextSortOrder() {
  const row = await get('SELECT MAX(sort_order) AS m FROM ewc_games');
  return (row?.m == null ? -1 : row.m) + 1;
}

export async function createEwcGame({ slug, title, description, status, owner, focus = [], discordChannelId = null }) {
  await ensureSeeded();
  const now = nowText();
  await run(
    `INSERT INTO ewc_games
       (slug, title_json, description_json, status_json, owner_json, focus_json, discord_channel_id,
        sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      slug,
      JSON.stringify(title),
      JSON.stringify(description),
      JSON.stringify(status),
      JSON.stringify(owner),
      JSON.stringify(focus),
      discordChannelId || null,
      await nextSortOrder(),
      now,
      now,
    ],
  );
  return getEwcGame(slug);
}

export async function updateEwcGame(slug, { title, description, status, owner, focus = [], discordChannelId = null }) {
  const info = await run(
    `UPDATE ewc_games
     SET title_json = $1, description_json = $2, status_json = $3, owner_json = $4,
         focus_json = $5, discord_channel_id = $6, updated_at = $7
     WHERE slug = $8`,
    [
      JSON.stringify(title),
      JSON.stringify(description),
      JSON.stringify(status),
      JSON.stringify(owner),
      JSON.stringify(focus),
      discordChannelId || null,
      nowText(),
      slug,
    ],
  );
  if (info.changes === 0) return null;
  return getEwcGame(slug);
}

// Deleting a game also removes its news posts (and their translations) so nothing is orphaned.
export async function deleteEwcGame(slug) {
  return transaction(async (tx) => {
    await tx.run(
      `DELETE FROM ewc_news_post_translations
       WHERE post_id IN (SELECT id FROM ewc_news_posts WHERE game_slug = $1)`,
      [slug],
    );
    const posts = await tx.run('DELETE FROM ewc_news_posts WHERE game_slug = $1', [slug]);
    await tx.run('DELETE FROM ewc_admin_game_scopes WHERE game_slug = $1', [slug]);
    const game = await tx.run('DELETE FROM ewc_games WHERE slug = $1', [slug]);
    return { gameDeleted: game.changes, postsDeleted: posts.changes };
  });
}

export async function reorderEwcGames(slugs) {
  const existing = (await all('SELECT slug FROM ewc_games')).map((r) => r.slug);
  if (
    slugs.length !== existing.length ||
    new Set(slugs).size !== slugs.length ||
    !slugs.every((s) => existing.includes(s))
  ) {
    throw new Error('Reorder must include every existing slug exactly once.');
  }
  await transaction(async (tx) => {
    const now = nowText();
    for (const [index, slug] of slugs.entries()) {
      await tx.run('UPDATE ewc_games SET sort_order = $1, updated_at = $2 WHERE slug = $3', [index, now, slug]);
    }
  });
  return listEwcGames();
}
