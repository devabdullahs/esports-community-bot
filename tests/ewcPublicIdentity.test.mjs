import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-public-identity-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { db } = await import('../src/db/connection.js');
const {
  getEwcProfileLinkByDiscordUser,
  publicEwcProfileIdentitiesByDiscordUserIds,
  upsertPublicEwcPredictorIdentity,
  upsertEwcProfileLink,
} = await import('../src/db/ewcProfileLinks.js');
const { getPublicEwcLeaderboard } = await import('../src/lib/ewcProfileStats.js');
const { saveWeeklyPredictionScore, upsertEwcWeek, upsertWeeklyPrediction } = await import('../src/db/ewcPredictions.js');

db.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, name TEXT, image TEXT)');

function authUser(id, name, image = null) {
  db.prepare('INSERT OR REPLACE INTO "user" (id, name, image) VALUES (?, ?, ?)').run(id, name, image);
}

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('profile links are public and resolve the current auth name through an opaque avatar token', async () => {
  const base = { authUserId: 'auth-public-identity-1', discordUserId: '200000000000000501', guildId: '900000000000000501', season: '2026' };
  authUser(base.authUserId, 'Falcons fan', 'https://cdn.discordapp.com/avatars/200000000000000501/avatar.png');
  const created = await upsertEwcProfileLink(base);
  assert.equal(created.publicIdentityEnabled, true);

  const identities = await publicEwcProfileIdentitiesByDiscordUserIds([base.discordUserId]);
  assert.equal(identities.get(base.discordUserId)?.displayName, 'Falcons fan');
  assert.match(identities.get(base.discordUserId)?.avatarToken, /^[0-9a-f-]{36}$/);
  const updated = await getEwcProfileLinkByDiscordUser(base.discordUserId);
  assert.equal(updated.publicIdentityEnabled, true);
  assert.equal(updated.publicDisplayName, 'Falcons fan');
});

test('public leaderboard publishes linked and Discord-snapshotted names without serializing internal IDs', async () => {
  const guildId = '900000000000000502';
  const season = '2026';
  const users = [
    { id: '200000000000000502', auth: 'auth-public-a', score: 900, name: 'Shared Name' },
    { id: '200000000000000503', auth: 'auth-public-b', score: 700, name: 'Shared Name' },
    { id: '200000000000000504', auth: 'auth-public-c', score: 500, name: 'Third Predictor' },
  ];
  const week = await upsertEwcWeek({ guildId, season, weekKey: 'identity-week', label: 'Identity week', createdBy: 'test' });
  for (const user of users) {
    authUser(user.auth, user.name, `https://cdn.discordapp.com/avatars/${user.id}/avatar.png`);
    await upsertWeeklyPrediction({ guildId, weekId: week.id, userId: user.id, picks: ['Team Falcons'] });
    await saveWeeklyPredictionScore(guildId, week.id, user.id, user.score, { total: user.score });
    if (user === users.at(-1)) {
      await upsertPublicEwcPredictorIdentity({
        discordUserId: user.id,
        displayName: user.name,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/avatar.png`,
      });
    } else {
      await upsertEwcProfileLink({ authUserId: user.auth, discordUserId: user.id, guildId, season });
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
      return publicEwcProfileIdentitiesByDiscordUserIds(ids);
    },
  });
  assert.equal(lookups, 1);
  assert.deepEqual(board.rows.map((row) => row.displayName), ['Shared Name (1)', 'Shared Name (2)', 'Third Predictor']);
  assert.equal(board.rows.every((row) => /^\/api\/ewc\/public-avatar\/[0-9a-f-]{36}$/.test(row.avatarUrl)), true);
  const serialized = JSON.stringify(board);
  for (const user of users) {
    assert.equal(serialized.includes(user.id), false);
    assert.equal(serialized.includes(user.auth), false);
  }
  assert.equal(serialized.includes('cdn.discordapp.com'), false);
});
