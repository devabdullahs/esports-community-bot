import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-media-discord-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { run } = await import('../src/db/client.js');
const { createEwcMediaChannel, updateEwcMediaChannel, deleteEwcMediaChannel } = await import(
  '../src/db/ewcMediaChannels.js'
);
const {
  deleteMediaDiscordPost,
  getMediaDiscordPost,
  listMediaDiscordPosts,
  listUnpostedAnnounceableMediaChannels,
  recordMediaDiscordPost,
  touchMediaDiscordPost,
} = await import('../src/db/ewcMediaDiscordPosts.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
function makeChannel({ discordChannelId = null, gameSlug = null } = {}) {
  const slug = `chan-${++n}`;
  return createEwcMediaChannel({
    slug,
    name: { en: `Channel ${n}`, ar: `قناة ${n}` },
    description: { en: 'Desc', ar: 'وصف' },
    links: [],
    discordChannelId,
    gameSlug,
  });
}

test('record + get + delete a media Discord row (CRUD + upsert)', async () => {
  const ch = await makeChannel({ discordChannelId: '100' });
  assert.equal(await getMediaDiscordPost(ch.slug), null);

  await recordMediaDiscordPost(ch.slug, { guildId: '111', channelId: '100', messageId: '333' });
  const row = await getMediaDiscordPost(ch.slug);
  assert.equal(row.slug, ch.slug);
  assert.equal(row.guild_id, '111');
  assert.equal(row.channel_id, '100');
  assert.equal(row.message_id, '333');
  assert.ok(row.posted_at, 'posted_at is set');

  // Upsert: re-recording updates channel/message in place.
  await recordMediaDiscordPost(ch.slug, { guildId: '111', channelId: '999', messageId: '444' });
  assert.equal((await getMediaDiscordPost(ch.slug)).channel_id, '999');
  assert.equal((await getMediaDiscordPost(ch.slug)).message_id, '444');

  await deleteMediaDiscordPost(ch.slug);
  assert.equal(await getMediaDiscordPost(ch.slug), null);
});

test('anti-join returns only opted-in channels (discord_channel_id set) without a row', async () => {
  const optedIn = await makeChannel({ discordChannelId: '200' });
  const noChannel = await makeChannel({ discordChannelId: null });
  const alreadyPosted = await makeChannel({ discordChannelId: '201' });
  await recordMediaDiscordPost(alreadyPosted.slug, { guildId: '1', channelId: '201', messageId: '3' });

  const slugs = (await listUnpostedAnnounceableMediaChannels()).map((r) => r.slug);
  assert.ok(slugs.includes(optedIn.slug), 'opted-in + unposted is included');
  assert.ok(!slugs.includes(noChannel.slug), 'channel without a Discord id is excluded');
  assert.ok(!slugs.includes(alreadyPosted.slug), 'already-posted is excluded');

  await deleteEwcMediaChannel(optedIn.slug);
  await deleteEwcMediaChannel(noChannel.slug);
  await deleteEwcMediaChannel(alreadyPosted.slug);
});

test('listMediaDiscordPosts exposes channel updated_at, target id, and game for the announcer', async () => {
  const ch = await makeChannel({ discordChannelId: '300', gameSlug: 'valorant' });
  await recordMediaDiscordPost(ch.slug, { guildId: '1', channelId: '300', messageId: '3' });
  const rows = (await listMediaDiscordPosts()).filter((r) => r.slug === ch.slug);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].discord_channel_id, '300');
  assert.equal(rows[0].game_slug, 'valorant');
  assert.ok(rows[0].updated_at, 'channel updated_at exposed for edit detection');
  await deleteEwcMediaChannel(ch.slug);
});

test('clearing the channel id makes the row a delete candidate (channel_id != target)', async () => {
  const ch = await makeChannel({ discordChannelId: '400' });
  await recordMediaDiscordPost(ch.slug, { guildId: '1', channelId: '400', messageId: '3' });
  await updateEwcMediaChannel(ch.slug, {
    name: ch.name,
    description: ch.description,
    links: [],
    discordChannelId: null,
    gameSlug: null,
  });
  const row = (await listMediaDiscordPosts()).find((r) => r.slug === ch.slug);
  assert.ok(row, 'row still present until the announcer cleans it');
  assert.ok(!row.discord_channel_id, 'target cleared -> announcer will remove the message');
  await deleteEwcMediaChannel(ch.slug);
});

test('touchMediaDiscordPost advances posted_at', async () => {
  const ch = await makeChannel({ discordChannelId: '500' });
  await recordMediaDiscordPost(ch.slug, { guildId: '1', channelId: '500', messageId: '3' });
  await run(`UPDATE ewc_media_discord_posts SET posted_at = '2000-01-01 00:00:00' WHERE slug = $1`, [ch.slug]);
  const before = (await getMediaDiscordPost(ch.slug)).posted_at;
  await touchMediaDiscordPost(ch.slug);
  const after = (await getMediaDiscordPost(ch.slug)).posted_at;
  assert.ok(after > before, 'posted_at moves forward after touch');
  await deleteEwcMediaChannel(ch.slug);
});

test('deleteEwcMediaChannel removes the Discord row explicitly (no FK cascade)', async () => {
  const ch = await makeChannel({ discordChannelId: '600' });
  await recordMediaDiscordPost(ch.slug, { guildId: '1', channelId: '600', messageId: '3' });
  assert.ok((await getMediaDiscordPost(ch.slug)) !== null);

  await deleteEwcMediaChannel(ch.slug);
  assert.equal(await getMediaDiscordPost(ch.slug), null, 'row is gone after the channel is deleted');
});
