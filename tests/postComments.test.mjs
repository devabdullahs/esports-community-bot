import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'post-comments-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { createEwcNewsPost } = await import('../src/db/ewcNewsPosts.js');
const {
  createComment,
  getComment,
  listCommentsForPost,
  editComment,
  setCommentStatus,
  autoApproveDueComments,
} = await import('../src/db/postComments.js');
const { setPostLike, removePostLike, getPostLikeSummary } = await import('../src/db/postLikes.js');
const {
  setCommentLike,
  removeCommentLike,
  getCommentLikeCounts,
  getViewerCommentLikes,
} = await import('../src/db/commentLikes.js');

let postId;
test('setup: create a published post', async () => {
  const post = await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'published',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: { en: { title: 'T', summary: 'S', body: 'B' } },
  });
  postId = post.id;
  assert.ok(postId);
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('root comment + one-level reply; reply-to-reply attaches to the root', async () => {
  const root = (await createComment({
    postId,
    authUserId: 'u1',
    discordUserId: 'd1',
    authorName: 'A',
    authorAvatarUrl: 'https://cdn.discordapp.com/avatars/d1/avatar.png?size=128',
    body: 'root',
  })).comment;
  assert.equal(root.parentCommentId, null);
  assert.equal(root.rootCommentId, null);
  assert.equal(root.authorAvatarUrl, 'https://cdn.discordapp.com/avatars/d1/avatar.png?size=128');

  const reply = (await createComment({ postId, parentCommentId: root.id, authUserId: 'u2', discordUserId: 'd2', body: 'reply' })).comment;
  assert.equal(Number(reply.parentCommentId), Number(root.id));
  assert.equal(Number(reply.rootCommentId), Number(root.id));

  // Reply to the reply -> re-targeted to the same root.
  const nested = (await createComment({ postId, parentCommentId: reply.id, authUserId: 'u3', discordUserId: 'd3', body: 'nested' })).comment;
  assert.equal(Number(nested.rootCommentId), Number(root.id));
  assert.equal(Number(nested.parentCommentId), Number(root.id));
});

test('reply to a non-existent / cross-post parent is rejected', async () => {
  const r = await createComment({ postId, parentCommentId: 999999, authUserId: 'u', discordUserId: 'd', body: 'x' });
  assert.equal(r.error, 'parent-not-found');
});

test('soft delete keeps the row and replies', async () => {
  const root = (await createComment({ postId, authUserId: 'u4', discordUserId: 'd4', body: 'will be deleted' })).comment;
  await createComment({ postId, parentCommentId: root.id, authUserId: 'u5', discordUserId: 'd5', body: 'child' });
  await setCommentStatus(root.id, 'deleted', { deletedBy: 'd4' });
  const after = await getComment(root.id);
  assert.equal(after.status, 'deleted');
  assert.equal(after.deletedBy, 'd4');
  // still present in the post listing (service decides placeholder rendering)
  const list = await listCommentsForPost(postId);
  assert.ok(list.some((c) => Number(c.id) === Number(root.id) && c.status === 'deleted'));
});

test('edit re-runs moderation (status can drop back to pending)', async () => {
  const c = (await createComment({ postId, authUserId: 'u6', discordUserId: 'd6', body: 'clean' })).comment;
  const edited = await editComment(c.id, { body: 'now flagged', status: 'pending', flagReason: { profanity: ['x'] } });
  assert.equal(edited.status, 'pending');
  assert.deepEqual(edited.flagReason, { profanity: ['x'] });
});

test('post like is idempotent; unlike is idempotent', async () => {
  const a = await setPostLike(postId, 'liker1');
  assert.equal(a.created, true);
  const b = await setPostLike(postId, 'liker1');
  assert.equal(b.created, false, 'second like is a no-op');
  await setPostLike(postId, 'liker2');
  assert.equal((await getPostLikeSummary(postId, 'liker1')).count, 2);
  assert.equal((await getPostLikeSummary(postId, 'liker1')).liked, true);
  assert.equal((await getPostLikeSummary(postId, 'nobody')).liked, false);

  const r = await removePostLike(postId, 'liker1');
  assert.equal(r.removed, true);
  const r2 = await removePostLike(postId, 'liker1');
  assert.equal(r2.removed, false, 'unlike again is idempotent');
  assert.equal((await getPostLikeSummary(postId)).count, 1);
});

test('comment likes: uniqueness + batched counts/viewer state', async () => {
  const c = (await createComment({ postId, authUserId: 'u7', discordUserId: 'd7', body: 'like me' })).comment;
  await setCommentLike(c.id, 'L1');
  await setCommentLike(c.id, 'L1'); // idempotent
  await setCommentLike(c.id, 'L2');
  const counts = await getCommentLikeCounts([c.id]);
  assert.equal(counts[c.id], 2);
  const liked = await getViewerCommentLikes([c.id], 'L1');
  assert.ok(liked.has(c.id));
  await removeCommentLike(c.id, 'L1');
  assert.equal((await getCommentLikeCounts([c.id]))[c.id], 1);
});

test('auto-approve only link-only pending comments after the timer', async () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  // link-only pending: has an auto_approve_at in the past
  const linkOnly = (await createComment({
    postId, authUserId: 'u8', discordUserId: 'd8', body: 'see site.example',
    status: 'pending', flagReason: { links: ['site.example'] }, autoApproveAt: past,
  })).comment;
  // profanity pending: no auto_approve timer -> must NOT auto-approve
  const profane = (await createComment({
    postId, authUserId: 'u9', discordUserId: 'd9', body: 'bad',
    status: 'pending', flagReason: { profanity: ['bad'] }, autoApproveAt: null,
  })).comment;

  const res = await autoApproveDueComments();
  assert.ok(res.approved >= 1);
  assert.equal((await getComment(linkOnly.id)).status, 'visible');
  assert.equal((await getComment(profane.id)).status, 'pending', 'profanity stays pending');
});

test('moderation status transitions clear/keep timers correctly', async () => {
  const c = (await createComment({
    postId, authUserId: 'u10', discordUserId: 'd10', body: 'pending link',
    status: 'pending', autoApproveAt: Math.floor(Date.now() / 1000) + 9999,
  })).comment;
  const approved = await setCommentStatus(c.id, 'visible');
  assert.equal(approved.status, 'visible');
  assert.equal(approved.autoApproveAt, null, 'approve clears the auto-approve timer');
});

// --- reply interactability (PR #23) ----------------------------------------

async function rootWithStatus(status, discordUserId = 'owner') {
  const root = (await createComment({ postId, authUserId: `auth-${discordUserId}`, discordUserId, body: 'root' })).comment;
  if (status !== 'visible') await setCommentStatus(root.id, status, { deletedBy: discordUserId });
  return root;
}

test('reply to a deleted parent is rejected', async () => {
  const root = await rootWithStatus('deleted');
  const r = await createComment({ postId, parentCommentId: root.id, authUserId: 'a', discordUserId: 'replier', body: 'x' });
  assert.equal(r.error, 'parent-not-interactable');
});

test('reply to a hidden parent is rejected', async () => {
  const root = await rootWithStatus('hidden');
  const r = await createComment({ postId, parentCommentId: root.id, authUserId: 'a', discordUserId: 'replier', body: 'x' });
  assert.equal(r.error, 'parent-not-interactable');
});

test('reply to a rejected parent is rejected', async () => {
  const root = await rootWithStatus('rejected');
  const r = await createComment({ postId, parentCommentId: root.id, authUserId: 'a', discordUserId: 'replier', body: 'x' });
  assert.equal(r.error, 'parent-not-interactable');
});

test("reply to someone else's pending parent is rejected", async () => {
  const root = (await createComment({ postId, authUserId: 'a-owner', discordUserId: 'owner-p', body: 'pending root', status: 'pending' })).comment;
  const r = await createComment({ postId, parentCommentId: root.id, authUserId: 'a', discordUserId: 'someone-else', body: 'x' });
  assert.equal(r.error, 'parent-not-interactable');
});

test('reply to your OWN pending parent is allowed (own pending thread)', async () => {
  const mine = (await createComment({ postId, authUserId: 'a-self', discordUserId: 'self-p', body: 'my pending root', status: 'pending' })).comment;
  const r = await createComment({ postId, parentCommentId: mine.id, authUserId: 'a-self', discordUserId: 'self-p', body: 'reply to my own' });
  assert.ok(r.comment, 'reply created');
  assert.equal(Number(r.comment.rootCommentId), Number(mine.id));
});

test('reply-to-reply still attaches to the visible root', async () => {
  const root = (await createComment({ postId, authUserId: 'a1', discordUserId: 'r1', body: 'root v' })).comment;
  const reply = (await createComment({ postId, parentCommentId: root.id, authUserId: 'a2', discordUserId: 'r2', body: 'reply' })).comment;
  const nested = await createComment({ postId, parentCommentId: reply.id, authUserId: 'a3', discordUserId: 'r3', body: 'nested' });
  assert.ok(nested.comment);
  assert.equal(Number(nested.comment.rootCommentId), Number(root.id));
  assert.equal(Number(nested.comment.parentCommentId), Number(root.id));
});
