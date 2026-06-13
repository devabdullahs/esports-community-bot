import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-games-reorder-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { createEwcGame, listEwcGames, reorderEwcGames } = await import('../src/db/ewcGames.js');

const GAME_A = {
  slug: 'test-game-a',
  title: { en: 'Test Game A', ar: 'لعبة أ' },
  description: { en: '', ar: '' },
  status: { en: '', ar: '' },
  owner: { en: '', ar: '' },
  focus: [],
};
const GAME_B = {
  slug: 'test-game-b',
  title: { en: 'Test Game B', ar: 'لعبة ب' },
  description: { en: '', ar: '' },
  status: { en: '', ar: '' },
  owner: { en: '', ar: '' },
  focus: [],
};
const GAME_C = {
  slug: 'test-game-c',
  title: { en: 'Test Game C', ar: 'لعبة ج' },
  description: { en: '', ar: '' },
  status: { en: '', ar: '' },
  owner: { en: '', ar: '' },
  focus: [],
};

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('reorderEwcGames throws when a slug is missing from input', async () => {
  await createEwcGame(GAME_A);
  await createEwcGame(GAME_B);
  await createEwcGame(GAME_C);

  // Only two of the test slugs, missing most seeded defaults — should throw
  await assert.rejects(
    () => reorderEwcGames(['test-game-a', 'test-game-b']),
    /Reorder must include every existing slug exactly once/,
  );
});

test('reorderEwcGames throws on duplicate slugs in input', async () => {
  // Get all current slugs and add a duplicate
  const allSlugs = (await listEwcGames()).map((g) => g.slug);
  const withDuplicate = [allSlugs[0], allSlugs[0], ...allSlugs.slice(1, -1)];
  await assert.rejects(
    () => reorderEwcGames(withDuplicate),
    /Reorder must include every existing slug exactly once/,
  );
});

test('reorderEwcGames throws on unknown slug in input', async () => {
  const allSlugs = (await listEwcGames()).map((g) => g.slug);
  // Replace last slug with an unknown one
  const withUnknown = [...allSlugs.slice(0, -1), 'does-not-exist'];
  await assert.rejects(
    () => reorderEwcGames(withUnknown),
    /Reorder must include every existing slug exactly once/,
  );
});

test('reorderEwcGames succeeds with all slugs in reversed order', async () => {
  const allSlugs = (await listEwcGames()).map((g) => g.slug);
  const reversed = [...allSlugs].reverse();
  const result = await reorderEwcGames(reversed);
  assert.equal(result[0].slug, reversed[0]);
  assert.equal(result[result.length - 1].slug, reversed[reversed.length - 1]);
});
