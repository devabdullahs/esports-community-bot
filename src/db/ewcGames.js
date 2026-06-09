import { db } from './index.js';
import { DEFAULT_GAMES } from '../lib/defaultGames.js';

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
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let seeded = false;
function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  const count = db.prepare('SELECT COUNT(*) AS c FROM ewc_games').get().c;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ewc_games
       (slug, title_json, description_json, status_json, owner_json, focus_json, sort_order,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  );
  const tx = db.transaction(() => {
    DEFAULT_GAMES.forEach((game, index) => {
      insert.run(
        game.slug,
        JSON.stringify(game.title),
        JSON.stringify(game.description),
        JSON.stringify(game.status),
        JSON.stringify(game.owner),
        JSON.stringify(game.focus || []),
        index,
      );
    });
  });
  tx();
}

export function listEwcGames() {
  ensureSeeded();
  return db
    .prepare('SELECT * FROM ewc_games ORDER BY sort_order ASC, slug ASC')
    .all()
    .map(hydrate);
}

export function getEwcGame(slug) {
  ensureSeeded();
  return hydrate(db.prepare('SELECT * FROM ewc_games WHERE slug = ?').get(slug));
}

function nextSortOrder() {
  const row = db.prepare('SELECT MAX(sort_order) AS m FROM ewc_games').get();
  return (row.m == null ? -1 : row.m) + 1;
}

export function createEwcGame({ slug, title, description, status, owner, focus = [] }) {
  ensureSeeded();
  db.prepare(
    `INSERT INTO ewc_games
       (slug, title_json, description_json, status_json, owner_json, focus_json, sort_order,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    slug,
    JSON.stringify(title),
    JSON.stringify(description),
    JSON.stringify(status),
    JSON.stringify(owner),
    JSON.stringify(focus),
    nextSortOrder(),
  );
  return getEwcGame(slug);
}

export function updateEwcGame(slug, { title, description, status, owner, focus = [] }) {
  const info = db
    .prepare(
      `UPDATE ewc_games
       SET title_json = ?, description_json = ?, status_json = ?, owner_json = ?,
           focus_json = ?, updated_at = datetime('now')
       WHERE slug = ?`,
    )
    .run(
      JSON.stringify(title),
      JSON.stringify(description),
      JSON.stringify(status),
      JSON.stringify(owner),
      JSON.stringify(focus),
      slug,
    );
  if (info.changes === 0) return null;
  return getEwcGame(slug);
}

// Deleting a game also removes its news posts (and their translations) so nothing is orphaned.
export function deleteEwcGame(slug) {
  const tx = db.transaction((gameSlug) => {
    db.prepare(
      `DELETE FROM ewc_news_post_translations
       WHERE post_id IN (SELECT id FROM ewc_news_posts WHERE game_slug = ?)`,
    ).run(gameSlug);
    const posts = db.prepare('DELETE FROM ewc_news_posts WHERE game_slug = ?').run(gameSlug);
    db.prepare('DELETE FROM ewc_admin_game_scopes WHERE game_slug = ?').run(gameSlug);
    const game = db.prepare('DELETE FROM ewc_games WHERE slug = ?').run(gameSlug);
    return { gameDeleted: game.changes, postsDeleted: posts.changes };
  });
  return tx(slug);
}

export function reorderEwcGames(slugs) {
  const update = db.prepare('UPDATE ewc_games SET sort_order = ?, updated_at = datetime(\'now\') WHERE slug = ?');
  const tx = db.transaction((orderedSlugs) => {
    orderedSlugs.forEach((slug, index) => update.run(index, slug));
  });
  tx(slugs);
  return listEwcGames();
}
