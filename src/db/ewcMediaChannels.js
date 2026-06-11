import { db } from './index.js';
import { DEFAULT_MEDIA_CHANNELS } from '../lib/defaultMediaChannels.js';

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
    name: parseJson(row.name_json, { en: '', ar: '' }),
    description: parseJson(row.description_json, { en: '', ar: '' }),
    logoUrl: row.logo_url,
    links: parseJson(row.links_json, []),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let seeded = false;
function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  const count = db.prepare('SELECT COUNT(*) AS c FROM ewc_media_channels').get().c;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ewc_media_channels
       (slug, name_json, description_json, logo_url, links_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  );
  const tx = db.transaction(() => {
    DEFAULT_MEDIA_CHANNELS.forEach((channel, index) => {
      insert.run(
        channel.slug,
        JSON.stringify(channel.name),
        JSON.stringify(channel.description),
        channel.logoUrl || null,
        JSON.stringify(channel.links || []),
        index,
      );
    });
  });
  tx();
}

export function listEwcMediaChannels() {
  ensureSeeded();
  return db
    .prepare('SELECT * FROM ewc_media_channels ORDER BY sort_order ASC, slug ASC')
    .all()
    .map(hydrate);
}

export function getEwcMediaChannel(slug) {
  ensureSeeded();
  return hydrate(db.prepare('SELECT * FROM ewc_media_channels WHERE slug = ?').get(slug));
}

function nextSortOrder() {
  const row = db.prepare('SELECT MAX(sort_order) AS m FROM ewc_media_channels').get();
  return (row.m == null ? -1 : row.m) + 1;
}

export function createEwcMediaChannel({ slug, name, description, logoUrl = null, links = [] }) {
  ensureSeeded();
  db.prepare(
    `INSERT INTO ewc_media_channels
       (slug, name_json, description_json, logo_url, links_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    slug,
    JSON.stringify(name),
    JSON.stringify(description),
    logoUrl,
    JSON.stringify(links),
    nextSortOrder(),
  );
  return getEwcMediaChannel(slug);
}

export function updateEwcMediaChannel(slug, { name, description, logoUrl = null, links = [] }) {
  const info = db
    .prepare(
      `UPDATE ewc_media_channels
       SET name_json = ?, description_json = ?, logo_url = ?, links_json = ?,
           updated_at = datetime('now')
       WHERE slug = ?`,
    )
    .run(JSON.stringify(name), JSON.stringify(description), logoUrl, JSON.stringify(links), slug);
  if (info.changes === 0) return null;
  return getEwcMediaChannel(slug);
}

// Deleting a channel also clears any admin scope rows that referenced it.
export function deleteEwcMediaChannel(slug) {
  const tx = db.transaction((channelSlug) => {
    db.prepare('DELETE FROM ewc_admin_media_scopes WHERE media_slug = ?').run(channelSlug);
    const result = db.prepare('DELETE FROM ewc_media_channels WHERE slug = ?').run(channelSlug);
    return { deleted: result.changes };
  });
  return tx(slug);
}

export function reorderEwcMediaChannels(slugs) {
  const existing = db.prepare('SELECT slug FROM ewc_media_channels').all().map((r) => r.slug);
  if (
    slugs.length !== existing.length ||
    new Set(slugs).size !== slugs.length ||
    !slugs.every((s) => existing.includes(s))
  ) {
    throw new Error('Reorder must include every existing slug exactly once.');
  }
  const update = db.prepare(
    "UPDATE ewc_media_channels SET sort_order = ?, updated_at = datetime('now') WHERE slug = ?",
  );
  const tx = db.transaction((orderedSlugs) => {
    orderedSlugs.forEach((slug, index) => update.run(index, slug));
  });
  tx(slugs);
  return listEwcMediaChannels();
}
