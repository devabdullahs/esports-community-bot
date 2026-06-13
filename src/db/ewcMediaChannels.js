import { all, get, run, transaction } from './client.js';
import { DEFAULT_MEDIA_CHANNELS } from '../lib/defaultMediaChannels.js';

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
async function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  const count = (await get('SELECT COUNT(*) AS c FROM ewc_media_channels'))?.c || 0;
  if (count > 0) return;
  await transaction(async (tx) => {
    const now = nowText();
    for (const [index, channel] of DEFAULT_MEDIA_CHANNELS.entries()) {
      await tx.run(
        `INSERT INTO ewc_media_channels
           (slug, name_json, description_json, logo_url, links_json, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO NOTHING`,
        [
          channel.slug,
          JSON.stringify(channel.name),
          JSON.stringify(channel.description),
          channel.logoUrl || null,
          JSON.stringify(channel.links || []),
          index,
          now,
          now,
        ],
      );
    }
  });
}

export async function listEwcMediaChannels() {
  await ensureSeeded();
  return (await all('SELECT * FROM ewc_media_channels ORDER BY sort_order ASC, slug ASC')).map(hydrate);
}

export async function getEwcMediaChannel(slug) {
  await ensureSeeded();
  return hydrate(await get('SELECT * FROM ewc_media_channels WHERE slug = $1', [slug]));
}

async function nextSortOrder() {
  const row = await get('SELECT MAX(sort_order) AS m FROM ewc_media_channels');
  return (row?.m == null ? -1 : row.m) + 1;
}

export async function createEwcMediaChannel({ slug, name, description, logoUrl = null, links = [] }) {
  await ensureSeeded();
  const now = nowText();
  await run(
    `INSERT INTO ewc_media_channels
       (slug, name_json, description_json, logo_url, links_json, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      slug,
      JSON.stringify(name),
      JSON.stringify(description),
      logoUrl,
      JSON.stringify(links),
      await nextSortOrder(),
      now,
      now,
    ],
  );
  return getEwcMediaChannel(slug);
}

export async function updateEwcMediaChannel(slug, { name, description, logoUrl = null, links = [] }) {
  const info = await run(
    `UPDATE ewc_media_channels
     SET name_json = $1, description_json = $2, logo_url = $3, links_json = $4,
         updated_at = $5
     WHERE slug = $6`,
    [JSON.stringify(name), JSON.stringify(description), logoUrl, JSON.stringify(links), nowText(), slug],
  );
  if (info.changes === 0) return null;
  return getEwcMediaChannel(slug);
}

// Deleting a channel also clears any admin scope rows that referenced it.
export async function deleteEwcMediaChannel(slug) {
  return transaction(async (tx) => {
    await tx.run('DELETE FROM ewc_admin_media_scopes WHERE media_slug = $1', [slug]);
    const result = await tx.run('DELETE FROM ewc_media_channels WHERE slug = $1', [slug]);
    return { deleted: result.changes };
  });
}

export async function reorderEwcMediaChannels(slugs) {
  const existing = (await all('SELECT slug FROM ewc_media_channels')).map((r) => r.slug);
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
      await tx.run('UPDATE ewc_media_channels SET sort_order = $1, updated_at = $2 WHERE slug = $3', [index, now, slug]);
    }
  });
  return listEwcMediaChannels();
}
