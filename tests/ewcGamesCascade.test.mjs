import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Own isolated temp DB — keeps this file independent from the news-posts fixture DB.
const dir = mkdtempSync(join(tmpdir(), 'ewc-cascade-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { get } = await import('../src/db/client.js');
const { createEwcGame, deleteEwcGame } = await import('../src/db/ewcGames.js');
const { createEwcNewsPost, getEwcNewsPostById } = await import('../src/db/ewcNewsPosts.js');
const { upsertEwcAdmin, setEwcAdminGameScopes, getEwcAdminGameScopes } = await import('../src/db/ewcAdmins.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('deleteEwcGame cascades: removes posts, translations, and admin scopes without touching a second game', async () => {
  // ── Seed game under test ──────────────────────────────────────────────────
  await createEwcGame({
    slug: 'cascade-game',
    title: { en: 'Cascade Game', ar: 'لعبة' },
    description: { en: 'desc', ar: 'وصف' },
    status: { en: 'active', ar: 'نشط' },
    owner: { en: 'owner', ar: 'المالك' },
    focus: [],
  });

  // ── Seed second game that must remain untouched ───────────────────────────
  await createEwcGame({
    slug: 'neighbor-game',
    title: { en: 'Neighbor', ar: 'جار' },
    description: { en: 'nd', ar: 'وصف' },
    status: { en: 'active', ar: 'نشط' },
    owner: { en: 'o', ar: 'م' },
    focus: [],
  });

  // ── Two posts for the game under test ─────────────────────────────────────
  const post1 = await createEwcNewsPost({
    gameSlug: 'cascade-game',
    status: 'published',
    contentMode: 'translated',
    defaultLocale: 'en',
    translations: {
      en: { title: 'News EN', summary: 'sum', body: 'body' },
      ar: { title: 'أخبار', summary: 'ملخص', body: 'جسم' },
    },
  });
  const post2 = await createEwcNewsPost({
    gameSlug: 'cascade-game',
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title: 'Draft news', summary: '', body: 'draft body' },
    },
  });

  // ── One post for the neighbor game ────────────────────────────────────────
  const neighborPost = await createEwcNewsPost({
    gameSlug: 'neighbor-game',
    status: 'published',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title: 'Neighbor news', summary: '', body: 'body' },
    },
  });

  // ── Admin with scope on BOTH games ───────────────────────────────────────
  await upsertEwcAdmin({ discordId: 'admin-001', displayName: 'Test Admin' });
  await setEwcAdminGameScopes('admin-001', ['cascade-game', 'neighbor-game']);

  // Confirm setup: translations exist for post1
  const translationCountBefore = (
    await get('SELECT COUNT(*) AS n FROM ewc_news_post_translations WHERE post_id = $1', [post1.id])
  ).n;
  assert.ok(translationCountBefore >= 1, 'post1 has at least one translation before delete');

  // ── Delete the game ───────────────────────────────────────────────────────
  const result = await deleteEwcGame('cascade-game');

  // 1. Return value must report exactly what was deleted
  assert.deepEqual(result, { gameDeleted: 1, postsDeleted: 2 });

  // 2. Both posts are gone from the news table
  assert.equal(await getEwcNewsPostById(post1.id), null, 'post1 removed after cascade delete');
  assert.equal(await getEwcNewsPostById(post2.id), null, 'post2 removed after cascade delete');

  // 3. Translations for those posts are gone. deleteEwcGame removes them
  //    explicitly before deleting posts, so this verifies the cleanup path
  //    instead of depending on cascade side effects.
  const translationCount = (
    await get(
      `SELECT COUNT(*) AS n FROM ewc_news_post_translations
       WHERE post_id IN ($1, $2)`,
      [post1.id, post2.id],
    )
  ).n;
  assert.equal(translationCount, 0, 'all translations for deleted posts are removed');

  // 4. Admin scope for the deleted game is gone, but neighbor-game scope remains
  const scopes = await getEwcAdminGameScopes('admin-001');
  assert.ok(!scopes.includes('cascade-game'), 'cascade-game scope removed from admin');
  assert.ok(scopes.includes('neighbor-game'), 'neighbor-game scope preserved on admin');

  // 5. Neighbor game's post is still readable
  assert.ok((await getEwcNewsPostById(neighborPost.id)) !== null, 'neighbor post still readable');
});
