import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'comment-keyword-rules-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const {
  createCommentKeywordRule,
  listCommentKeywordRules,
  listEnabledCommentKeywordRules,
  updateCommentKeywordRule,
} = await import('../src/db/commentKeywordRules.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('keyword rules preserve display text, normalize duplicates, update, and disable', async () => {
  const created = await createCommentKeywordRule({
    phrase: '  ScAm Link  ', locale: 'en', scope: 'news', action: 'hold', createdBy: 'admin-1',
  });
  assert.equal(created.phrase, 'ScAm Link');
  assert.equal(created.phraseNormalized, 'scam link');
  assert.equal(created.enabled, true);

  await assert.rejects(
    createCommentKeywordRule({
      phrase: 'scam link', locale: 'en', scope: 'news', action: 'flag', createdBy: 'admin-2',
    }),
    /unique/i,
  );
  await assert.rejects(
    createCommentKeywordRule({
      phrase: 'x'.repeat(161), locale: 'all', scope: 'global', action: 'flag', createdBy: 'admin-1',
    }),
    /160 characters/i,
  );

  const updated = await updateCommentKeywordRule(created.id, {
    phrase: 'Potential spoiler', locale: 'all', scope: 'match', action: 'flag', enabled: false,
  });
  assert.deepEqual(
    { phrase: updated.phrase, phraseNormalized: updated.phraseNormalized, locale: updated.locale, scope: updated.scope, action: updated.action, enabled: updated.enabled },
    { phrase: 'Potential spoiler', phraseNormalized: 'potential spoiler', locale: 'all', scope: 'match', action: 'flag', enabled: false },
  );
  assert.equal((await listEnabledCommentKeywordRules()).length, 0);
  assert.equal((await listCommentKeywordRules()).length, 1);
});
