import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'community-users-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { createEwcNewsPost } = await import('../src/db/ewcNewsPosts.js');
const { createComment, setCommentStatus } = await import('../src/db/postComments.js');
const { setCommentLike } = await import('../src/db/commentLikes.js');
const { setPostLike } = await import('../src/db/postLikes.js');
const { activityForDiscordIds, activityQueries, listCommentsByAuthor } = await import('../src/db/communityUsers.js');

const userA = '400000000000000001';
const userB = '400000000000000002';
const userC = '400000000000000003';

let postId;
let firstCommentId;

test.before(async () => {
  const post = await createEwcNewsPost({
    gameSlug: 'valorant',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: { en: { title: 'T', summary: 'S', body: 'B' } },
    status: 'published',
  });
  postId = post.id;

  // User A: two live comments (one will become the like target), one deleted comment.
  const c1 = await createComment({ postId, authUserId: 'a1', discordUserId: userA, body: 'first comment' });
  firstCommentId = c1.comment.id;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await createComment({ postId, authUserId: 'a1', discordUserId: userA, body: 'second comment' });
  const c3 = await createComment({ postId, authUserId: 'a1', discordUserId: userA, body: 'deleted comment' });
  await setCommentStatus(c3.comment.id, 'deleted', { deletedBy: 'admin' });

  // User B: one comment.
  await createComment({ postId, authUserId: 'b1', discordUserId: userB, body: 'b comment' });

  // Likes: A likes a comment + a post (2 total); B likes a comment (1 total).
  await setCommentLike(firstCommentId, userA);
  await setPostLike(postId, userA);
  await setCommentLike(firstCommentId, userB);
  await setPostLike(postId, userC);
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('activityForDiscordIds returns an empty Map for no ids', async () => {
  const map = await activityForDiscordIds([]);
  assert.equal(map.size, 0);
});

test('activityForDiscordIds rolls up comment counts (excluding deleted), last comment, and likes', async () => {
  const map = await activityForDiscordIds([userA, userB]);

  const a = map.get(userA);
  assert.equal(a.commentCount, 2, 'deleted comment is excluded from the count');
  assert.equal(a.likeCount, 2, 'comment like + post like');
  assert.ok(a.lastCommentAt, 'last comment timestamp is present');
  assert.ok(a.lastLikeAt, 'last like timestamp is present');
  assert.ok(a.lastActivityAt, 'last activity timestamp is present');
  assert.ok(Date.parse(a.lastActivityAt.replace(' ', 'T') + 'Z') >= Date.parse(a.lastCommentAt.replace(' ', 'T') + 'Z'));

  const b = map.get(userB);
  assert.equal(b.commentCount, 1);
  assert.equal(b.likeCount, 1);
});

test('activityForDiscordIds treats likes as activity even without comments', async () => {
  const map = await activityForDiscordIds([userC]);
  const c = map.get(userC);

  assert.equal(c.commentCount, 0);
  assert.equal(c.likeCount, 1);
  assert.equal(c.lastCommentAt, null);
  assert.ok(c.lastLikeAt, 'last like timestamp is present');
  assert.equal(c.lastActivityAt, c.lastLikeAt);
});

test('activityForDiscordIds seeds zero entries for ids with no activity', async () => {
  const map = await activityForDiscordIds(['400000000000000009']);
  assert.deepEqual(map.get('400000000000000009'), {
    commentCount: 0,
    lastCommentAt: null,
    likeCount: 0,
    lastLikeAt: null,
    lastActivityAt: null,
  });
});

test('listCommentsByAuthor returns all statuses newest-first', async () => {
  const comments = await listCommentsByAuthor(userA);
  assert.equal(comments.length, 3, 'includes the deleted comment');
  // Newest-first: the deleted comment was created last.
  assert.equal(comments[0].body, 'deleted comment');
  assert.equal(comments[0].status, 'deleted');
  assert.equal(comments[comments.length - 1].body, 'first comment');
  assert.equal(comments[0].postId, postId);
});

test('listCommentsByAuthor respects the limit', async () => {
  const comments = await listCommentsByAuthor(userA, 1);
  assert.equal(comments.length, 1);
});

// Regression for the Postgres-only "bind message supplies N parameters, but
// prepared statement requires M" crash: SQLite's per-occurrence placeholder
// rewrite tolerates reusing $1..$N across two IN clauses, so a functional
// SQLite test cannot catch it. Assert the invariant directly — every distinct
// $n in a query must have exactly one matching param, and the max index equals
// the param count (no reuse, no gaps).
test('activityQueries: placeholders and params are 1:1 (dual-backend safe)', () => {
  const distinctPlaceholders = (sql) => new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => m[1])).size;
  const maxPlaceholder = (sql) => Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));

  for (const ids of [['1'], ['1', '2', '3'], ['1', '2', '3', '4', '5', '6', '7', '8']]) {
    const { comments, likes } = activityQueries(ids);
    for (const { sql, params } of [comments, likes]) {
      assert.equal(distinctPlaceholders(sql), params.length, 'each placeholder has one param');
      assert.equal(maxPlaceholder(sql), params.length, 'highest $n equals the param count');
    }
    // The likes query references the ids in two IN clauses → twice the params.
    assert.equal(likes.params.length, ids.length * 2);
  }
});
