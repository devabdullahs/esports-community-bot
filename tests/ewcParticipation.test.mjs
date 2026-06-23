import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-participation-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { upsertEwcWeek, upsertWeeklyGamePick, upsertSeasonPrediction } = await import('../src/db/ewcPredictions.js');
const { setEwcPredictionsChannel } = await import('../src/db/settings.js');
const { announceEwcParticipation } = await import('../src/lib/ewcParticipation.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('upsertWeeklyGamePick reports firstPick only on the member\'s first pick of the week', async () => {
  const guildId = 'guild-participation-1';
  const week = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'week-1', label: 'Week 1', createdBy: 'admin' });
  const userId = '300000000000000001';

  const first = await upsertWeeklyGamePick({ guildId, weekId: week.id, userId, gameKey: 'valorant-1', game: 'Valorant', pick: 'Team Falcons' });
  assert.equal(first.firstPick, true, 'first pick of the week → firstPick true');

  // A different game pick the same week is NOT a new participant.
  const second = await upsertWeeklyGamePick({ guildId, weekId: week.id, userId, gameKey: 'dota-1', game: 'Dota 2', pick: 'Team Liquid' });
  assert.equal(second.firstPick, false, 'second pick (same week) → firstPick false');

  // Changing the original game pick is also not new participation.
  const change = await upsertWeeklyGamePick({ guildId, weekId: week.id, userId, gameKey: 'valorant-1', game: 'Valorant', pick: 'Gen.G' });
  assert.equal(change.firstPick, false, 'changing a pick → firstPick false');
});

test('upsertSeasonPrediction reports firstPick only on the first season submission', async () => {
  const guildId = 'guild-participation-2';
  const userId = '300000000000000002';

  const first = await upsertSeasonPrediction({ guildId, season: '2026', userId, picks: ['A', 'B', 'C', 'D', 'E'] });
  assert.equal(first.firstPick, true);

  const resubmit = await upsertSeasonPrediction({ guildId, season: '2026', userId, picks: ['F', 'G', 'H', 'I', 'J'] });
  assert.equal(resubmit.firstPick, false);
});

test('announceEwcParticipation no-ops when no predictions channel is configured', async () => {
  let fetched = false;
  const client = { channels: { fetch: async () => { fetched = true; return null; } } };
  await announceEwcParticipation(client, 'guild-no-channel', 'hi');
  assert.equal(fetched, false, 'should not touch Discord when no channel is set');
});

test('announceEwcParticipation can target the command channel without changing result channel settings', async () => {
  const guildId = 'guild-participation-command-channel';

  let fetchedId = null;
  let sent = null;
  const client = {
    channels: {
      fetch: async (id) => {
        fetchedId = id;
        return { isTextBased: () => true, send: async (payload) => { sent = payload; } };
      },
    },
  };

  await announceEwcParticipation(client, guildId, 'joined', { channelId: 'command-channel-456' });
  assert.equal(fetchedId, 'command-channel-456');
  assert.equal(sent.content, 'joined');
  assert.deepEqual(sent.allowedMentions, { parse: [] }, 'ping-free');
});

test('announceEwcParticipation posts the content ping-free to the configured channel', async () => {
  const guildId = 'guild-participation-3';
  await setEwcPredictionsChannel(guildId, 'chan-123');

  let sent = null;
  const client = {
    channels: {
      fetch: async (id) => (id === 'chan-123' ? { isTextBased: () => true, send: async (payload) => { sent = payload; } } : null),
    },
  };

  await announceEwcParticipation(client, guildId, '🎯 <@1> is in for **Week 1**!');
  assert.ok(sent, 'a message was sent');
  assert.equal(sent.content, '🎯 <@1> is in for **Week 1**!');
  assert.deepEqual(sent.allowedMentions, { parse: [] }, 'ping-free');
});

test('announceEwcParticipation swallows send errors (best-effort)', async () => {
  const guildId = 'guild-participation-4';
  await setEwcPredictionsChannel(guildId, 'chan-err');
  const client = {
    channels: { fetch: async () => ({ isTextBased: () => true, send: async () => { throw new Error('boom'); } }) },
  };
  // Must not throw into the interaction flow.
  await assert.doesNotReject(() => announceEwcParticipation(client, guildId, 'x'));
});
