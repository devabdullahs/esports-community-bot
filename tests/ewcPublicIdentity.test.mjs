import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const {
  getPublicEwcLeaderboard,
  getPublicEwcPredictorProfile,
  listPublicEwcPredictorRouteIds,
} = await import('../src/lib/ewcProfileStats.js');
const {
  markEwcWeekScored,
  saveWeeklyPredictionScore,
  upsertEwcWeek,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');

db.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, name TEXT, image TEXT)');

function authUser(id, name, image = null) {
  db.prepare('INSERT OR REPLACE INTO "user" (id, name, image) VALUES (?, ?, ?)').run(id, name, image);
}

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('public profile ordering keeps text timestamps separate from integer columns', () => {
  const source = readFileSync(new URL('../src/lib/ewcProfileStats.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /COALESCE\(w\.scored_at,\s*w\.close_at,\s*w\.id\)/i);
  assert.match(source, /ORDER BY w\.scored_at DESC, w\.close_at DESC, w\.id DESC/i);
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

test('unlinked predictors receive a stable opaque public route id without an avatar', async () => {
  const discordUserId = '200000000000000506';
  const created = await upsertPublicEwcPredictorIdentity({
    discordUserId,
    displayName: 'Avatarless Predictor',
  });
  const identities = await publicEwcProfileIdentitiesByDiscordUserIds([discordUserId]);
  assert.match(created?.avatarToken || '', /^[0-9a-f-]{36}$/);
  assert.equal(identities.get(discordUserId)?.avatarToken, created?.avatarToken);
  assert.equal(identities.get(discordUserId)?.hasAvatar, false);
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
  assert.equal(board.rows.every((row) => /^\/predictors\/[0-9a-f-]{36}$/.test(row.profileHref)), true);
  const serialized = JSON.stringify(board);
  for (const user of users) {
    assert.equal(serialized.includes(user.id), false);
    assert.equal(serialized.includes(user.auth), false);
  }
  assert.equal(serialized.includes('cdn.discordapp.com'), false);
});

function assertNoPrivateFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoPrivateFields(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.doesNotMatch(key, /(?:auth|discord|user.?id|token|session|setting|pick|detail|season)/i);
    assertNoPrivateFields(nested);
  }
}

test('public predictor projection returns only finalized performance and no private fields', async () => {
  const guildId = '900000000000000503';
  const season = '2026';
  const discordUserId = '200000000000000505';
  const authUserId = 'auth-public-profile-505';
  authUser(authUserId, 'Safe Predictor', `https://cdn.discordapp.com/avatars/${discordUserId}/avatar.png`);
  await upsertEwcProfileLink({ authUserId, discordUserId, guildId, season });

  const finalized = await upsertEwcWeek({ guildId, season, weekKey: 'final-week', label: 'Final week', createdBy: 'test' });
  await upsertWeeklyPrediction({ guildId, weekId: finalized.id, userId: discordUserId, picks: ['Private finalized pick'] });
  await saveWeeklyPredictionScore(guildId, finalized.id, discordUserId, 420, {
    bonus: 50,
    picks: ['Private finalized pick'],
    secretToken: 'do-not-publish',
  });
  await markEwcWeekScored(finalized.id, []);

  const unscored = await upsertEwcWeek({ guildId, season, weekKey: 'open-week', label: 'Open week', createdBy: 'test' });
  await upsertWeeklyPrediction({ guildId, weekId: unscored.id, userId: discordUserId, picks: ['Pre-lock private pick'] });
  await saveWeeklyPredictionScore(guildId, unscored.id, discordUserId, 900, {
    provisional: true,
    picks: ['Pre-lock private pick'],
  });

  const board = await getPublicEwcLeaderboard({ guildId, season });
  const publicId = board.rows.find((row) => row.displayName === 'Safe Predictor')?.profileHref?.split('/').at(-1);
  assert.match(publicId || '', /^[0-9a-f-]{36}$/);

  const profile = await getPublicEwcPredictorProfile({ publicId, guildId, season });
  assert.deepEqual(Object.keys(profile || {}).sort(), [
    'achievements',
    'avatarUrl',
    'displayName',
    'points',
    'rank',
    'recentFinalizedResults',
    'scoreSources',
    'sweeps',
    'weeks',
    'wins',
  ]);
  assert.deepEqual(profile?.recentFinalizedResults, [
    { weekKey: 'final-week', label: 'Final week', score: 420, bonus: 50, rank: 1, winner: true },
  ]);
  assert.deepEqual(profile?.scoreSources, [
    { key: 'open-week', label: 'Open week', kind: 'weekly', points: 900, provisional: true },
    { key: 'final-week', label: 'Final week', kind: 'weekly', points: 420, provisional: false },
  ]);
  assert.equal(profile?.points, 1320);
  assert.equal(profile?.scoreSources.reduce((sum, source) => sum + source.points, 0), profile?.points);
  assertNoPrivateFields(profile);

  const serialized = JSON.stringify(profile);
  for (const hiddenValue of [discordUserId, authUserId, 'Private finalized pick', 'Pre-lock private pick', 'do-not-publish']) {
    assert.equal(serialized.includes(hiddenValue), false);
  }

  assert.deepEqual(await listPublicEwcPredictorRouteIds({ guildId, season }), [publicId]);
});

test('unknown public predictor ids are not found', async () => {
  const profile = await getPublicEwcPredictorProfile({
    publicId: '00000000-0000-4000-8000-000000000000',
    guildId: '900000000000000503',
    season: '2026',
  });
  assert.equal(profile, null);
});
