import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-reminders-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const {
  getEwcPredictionReminder,
  upsertEwcWeek,
  upsertWeeklyGamePick,
} = await import('../src/db/ewcPredictions.js');
const { setEwcPredictionsChannel } = await import('../src/db/settings.js');
const { openingPredictionAnnouncementContents, sendDueEwcPredictionReminders } = await import('../src/jobs/ewcPredictions.js');

const NOW = 2_000_000;

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function seedRound({ suffix, lockAt = NOW + 2 * 3600, picked = false } = {}) {
  const guildId = `guild-reminder-${suffix}`;
  await setEwcPredictionsChannel(guildId, `channel-${suffix}`);
  const round = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: `week-${suffix}`,
    label: `Week ${suffix}`,
    openAt: NOW - 60,
    closeAt: NOW + 10_000,
    games: [{ key: 'game-a', game: 'Valorant', event: 'EWC Valorant', lockAt }],
    createdBy: 'test',
  });
  if (picked) {
    await upsertWeeklyGamePick({
      guildId,
      weekId: round.id,
      userId: `member-${suffix}`,
      gameKey: 'game-a',
      pick: 'Team Falcons',
    });
  } else {
    await upsertWeeklyGamePick({
      guildId,
      weekId: round.id,
      userId: `member-${suffix}`,
      gameKey: 'different-game',
      pick: 'Team Falcons',
    });
  }
  return { guildId, round };
}

function clientFor(channelId, send) {
  return {
    channels: {
      fetch: async (id) => (id === channelId ? { isTextBased: () => true, send } : null),
    },
  };
}

test('opening prediction copy lists every configured game lock and emphasizes independent locks', () => {
  const contents = openingPredictionAnnouncementContents({
    week_key: 'week-open',
    label: 'Week open',
    games: [
      { key: 'a', game: 'Valorant', lockAt: NOW + 1_000 },
      { key: 'b', game: 'Dota 2', lockAt: NOW + 2_000 },
      { key: 'c', game: 'Chess', lockAt: NOW + 3_000 },
      { key: 'd', game: 'Street Fighter', lockAt: NOW + 4_000 },
    ],
  }, NOW);

  assert.equal(contents.length, 1);
  const content = contents[0];
  assert.match(content, /locks independently/i);
  for (const lockAt of [NOW + 1_000, NOW + 2_000, NOW + 3_000, NOW + 4_000]) {
    assert.match(content, new RegExp(`<t:${lockAt}:F>`));
  }
  assert.match(content, new RegExp(`Next lock:.*<t:${NOW + 1_000}:F>`));
});

test('reminders are no-ping, durable, and claimed once across overlapping runs', async () => {
  const { guildId, round } = await seedRound({ suffix: 'overlap' });
  let sends = 0;
  let releaseSend;
  let startedSend;
  const sendStarted = new Promise((resolveStarted) => { startedSend = resolveStarted; });
  const client = clientFor('channel-overlap', async (payload) => {
    sends += 1;
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    startedSend();
    await new Promise((resolveSend) => { releaseSend = resolveSend; });
  });

  const first = sendDueEwcPredictionReminders(client, { now: NOW, reminderHours: 6 });
  await sendStarted;
  const overlapping = await sendDueEwcPredictionReminders(client, { now: NOW, reminderHours: 6 });
  assert.equal(overlapping, 0);
  assert.equal(sends, 1);
  releaseSend();
  assert.equal(await first, 1);
  assert.equal(await sendDueEwcPredictionReminders(client, { now: NOW, reminderHours: 6 }), 0);
  const reminder = await getEwcPredictionReminder({ guildId, weekId: round.id, gameKey: 'game-a', kind: 'pre_lock' });
  assert.ok(reminder?.sent_at);
  assert.equal(reminder?.claim_token, null);
});

test('failed reminder sends release their claim for a later retry', async () => {
  const { guildId, round } = await seedRound({ suffix: 'retry' });
  let fail = true;
  let sends = 0;
  const client = clientFor('channel-retry', async () => {
    sends += 1;
    if (fail) throw new Error('Discord unavailable');
  });

  assert.equal(await sendDueEwcPredictionReminders(client, { now: NOW, reminderHours: 6 }), 0);
  const pending = await getEwcPredictionReminder({ guildId, weekId: round.id, gameKey: 'game-a', kind: 'pre_lock' });
  assert.equal(pending?.sent_at, null);
  assert.equal(pending?.claim_token, null);
  fail = false;
  assert.equal(await sendDueEwcPredictionReminders(client, { now: NOW, reminderHours: 6 }), 1);
  assert.equal(sends, 2);
});

test('reminders skip complete, disabled, and already-locked games', async () => {
  const complete = await seedRound({ suffix: 'complete', picked: true });
  const locked = await seedRound({ suffix: 'locked', lockAt: NOW - 1 });
  let sends = 0;
  const client = {
    channels: { fetch: async () => ({ isTextBased: () => true, send: async () => { sends += 1; } }) },
  };

  assert.equal(await sendDueEwcPredictionReminders(client, { now: NOW, reminderHours: 6 }), 0);
  assert.equal(await sendDueEwcPredictionReminders(client, { now: NOW, reminderHours: 6, enabled: false }), 0);
  assert.equal(sends, 0);
  await assert.doesNotReject(getEwcPredictionReminder({ guildId: complete.guildId, weekId: complete.round.id, gameKey: 'game-a', kind: 'pre_lock' }));
  assert.equal(await getEwcPredictionReminder({ guildId: locked.guildId, weekId: locked.round.id, gameKey: 'game-a', kind: 'pre_lock' }), null);
});

test('SQLite and Postgres schemas declare the reminder table with its durable claim columns', () => {
  const root = resolve(import.meta.dirname, '..');
  const sqlite = readFileSync(join(root, 'src/db/index.js'), 'utf8');
  const postgres = readFileSync(join(root, 'scripts/postgres/schema.sql'), 'utf8');
  for (const schema of [sqlite, postgres]) {
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ewc_prediction_reminders/i);
    assert.match(schema, /week_id\s+\w+\s+NOT NULL REFERENCES ewc_prediction_weeks\(id\) ON DELETE CASCADE/i);
    assert.match(schema, /sent_at\s+TEXT/i);
    assert.match(schema, /claim_expires_at/i);
  }
});
