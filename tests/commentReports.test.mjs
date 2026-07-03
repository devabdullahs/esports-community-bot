import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'comment-reports-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { createEwcGame } = await import('../src/db/ewcGames.js');
const { createEwcNewsPost } = await import('../src/db/ewcNewsPosts.js');
const { createComment } = await import('../src/db/postComments.js');
const {
  createCommentReport,
  countOpenReportsForComment,
  openReportCountsForComments,
  listReportedComments,
  listReportsForComment,
  resolveReportsForComment,
  countCommentsWithOpenReports,
} = await import('../src/db/commentReports.js');

let commentId;

test.before(async () => {
  await createEwcGame({
    slug: 'g1', title: { en: 'G', ar: 'G' }, description: { en: '', ar: '' },
    status: { en: '', ar: '' }, owner: { en: '', ar: '' }, focus: [],
  });
  const post = await createEwcNewsPost({
    gameSlug: 'g1', contentMode: 'shared', defaultLocale: 'en',
    translations: { en: { title: 'T', summary: 'S', body: 'B' } },
    status: 'published', authorDiscordId: null, authorName: null, coverImageUrl: null,
  });
  const res = await createComment({
    postId: post.id, authUserId: 'auth-1', discordUserId: 'user-1', authorName: 'U1', body: 'hello',
  });
  commentId = res.comment.id;
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('a report is recorded once per reporter (repeats are a no-op)', async () => {
  const first = await createCommentReport({ commentId, reporterDiscordId: 'r1', reason: 'spam' });
  assert.equal(first.created, true);
  assert.equal(first.openCount, 1);

  const dup = await createCommentReport({ commentId, reporterDiscordId: 'r1', reason: 'harassment' });
  assert.equal(dup.created, false); // same reporter -> no new report
  assert.equal(dup.openCount, 1);

  const second = await createCommentReport({ commentId, reporterDiscordId: 'r2', reason: 'hate', detail: 'slur' });
  assert.equal(second.created, true);
  assert.equal(second.openCount, 2);
});

test('counts + moderation queue reflect open reports', async () => {
  assert.equal(await countOpenReportsForComment(commentId), 2);
  const counts = await openReportCountsForComments([commentId, 999999]);
  assert.equal(counts[commentId], 2);
  assert.equal(counts[999999], undefined);
  assert.equal(await countCommentsWithOpenReports(), 1);

  const queue = await listReportedComments({});
  assert.equal(queue.length, 1);
  assert.equal(Number(queue[0].id), Number(commentId));
  assert.equal(queue[0].reportOpenCount, 2); // hydrated row + open-report count
  assert.equal(queue[0].body, 'hello'); // hydrated comment fields are present

  const reports = await listReportsForComment(commentId);
  assert.equal(reports.length, 2);
  assert.ok(reports.some((r) => r.reason === 'spam'));
  assert.ok(reports.some((r) => r.reason === 'hate' && r.detail === 'slur'));
});

test('resolving closes open reports so the comment leaves the queue', async () => {
  const { updated } = await resolveReportsForComment(commentId, 'resolved');
  assert.equal(updated, 2);
  assert.equal(await countOpenReportsForComment(commentId), 0);
  assert.equal((await listReportedComments({})).length, 0);

  // A fresh reporter re-opens the comment in the queue.
  const again = await createCommentReport({ commentId, reporterDiscordId: 'r3', reason: 'other', detail: 'x' });
  assert.equal(again.created, true);
  assert.equal(again.openCount, 1);
  assert.equal((await listReportedComments({})).length, 1);
});
