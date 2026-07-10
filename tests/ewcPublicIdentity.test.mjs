import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-public-identity-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  getEwcProfileLinkByDiscordUser,
  setEwcProfileLinkPublicIdentity,
  upsertEwcProfileLink,
} = await import('../src/db/ewcProfileLinks.js');
const { getPublicEwcLeaderboard } = await import('../src/lib/ewcProfileStats.js');
const { saveWeeklyPredictionScore, upsertEwcWeek, upsertWeeklyPrediction } = await import('../src/db/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('profile links default to anonymous and disabling clears all consented snapshot fields', async () => {
  const base = { authUserId: 'auth-public-identity-1', discordUserId: '200000000000000501', guildId: '900000000000000501', season: '2026' };
  const created = await upsertEwcProfileLink(base);
  assert.equal(created.publicIdentityEnabled, false);
  assert.equal(created.publicDisplayName, null);
  assert.equal(created.publicAvatarUrl, null);

  const enabled = await setEwcProfileLinkPublicIdentity({ ...base, displayName: 'Falcons fan', avatarUrl: 'https://cdn.discordapp.com/avatars/200000000000000501/avatar.png' });
  assert.equal(enabled.publicIdentityEnabled, true);
  assert.equal(enabled.publicDisplayName, 'Falcons fan');
  assert.ok(enabled.publicAvatarToken);

  const disabled = await setEwcProfileLinkPublicIdentity({ ...base, displayName: null, avatarUrl: null });
  assert.equal(disabled.publicIdentityEnabled, false);
  assert.equal(disabled.publicDisplayName, null);
  assert.equal(disabled.publicAvatarUrl, null);
  assert.equal(disabled.publicAvatarToken, null);
  assert.equal((await getEwcProfileLinkByDiscordUser(base.discordUserId)).publicIdentityUpdatedAt != null, true);
});

test('public leaderboard makes one bounded identity lookup and never serializes internal user or auth IDs', async () => {
  const guildId = '900000000000000502';
  const season = '2026';
  const users = [
    { id: '200000000000000502', auth: 'auth-public-a', score: 900, name: 'Shared Name' },
    { id: '200000000000000503', auth: 'auth-public-b', score: 700, name: 'Shared Name' },
    { id: '200000000000000504', auth: 'auth-public-c', score: 500, name: null },
  ];
  const week = await upsertEwcWeek({ guildId, season, weekKey: 'identity-week', label: 'Identity week', createdBy: 'test' });
  for (const user of users) {
    await upsertWeeklyPrediction({ guildId, weekId: week.id, userId: user.id, picks: ['Team Falcons'] });
    await saveWeeklyPredictionScore(guildId, week.id, user.id, user.score, { total: user.score });
    await upsertEwcProfileLink({ authUserId: user.auth, discordUserId: user.id, guildId, season });
    if (user.name) {
      await setEwcProfileLinkPublicIdentity({
        authUserId: user.auth,
        discordUserId: user.id,
        displayName: user.name,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/avatar.png`,
      });
    }
  }
  let lookups = 0;
  const board = await getPublicEwcLeaderboard({
    guildId,
    season,
    limit: 50,
    identityLoader: async (ids) => {
      lookups += 1;
      assert.deepEqual(ids, users.map((user) => user.id));
      const { publicEwcProfileIdentitiesByDiscordUserIds } = await import('../src/db/ewcProfileLinks.js');
      return publicEwcProfileIdentitiesByDiscordUserIds(ids);
    },
  });
  assert.equal(lookups, 1);
  assert.deepEqual(board.rows.map((row) => row.displayName), ['Shared Name (1)', 'Shared Name (2)', 'Member 0504']);
  assert.match(board.rows[0].avatarUrl, /^\/api\/ewc\/public-avatar\/[0-9a-f-]{36}$/);
  assert.equal(board.rows[2].avatarUrl, null);
  const serialized = JSON.stringify(board);
  for (const user of users) {
    assert.equal(serialized.includes(user.id), false);
    assert.equal(serialized.includes(user.auth), false);
  }
  assert.equal(serialized.includes('cdn.discordapp.com'), false);
});
