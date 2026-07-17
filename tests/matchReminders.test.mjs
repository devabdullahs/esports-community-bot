import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'match-reminders-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.DISCORD_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';
process.env.EWC_DASHBOARD_PUBLIC_URL = 'https://example.test';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { upsertFollow } = await import('../src/db/userFollows.js');
const {
  cancelMatchReminder,
  getMatchReminderTarget,
  listActiveReminderMatchIdsForUser,
  listActiveReminderUserIdsForMatch,
  upsertMatchReminder,
} = await import('../src/db/userMatchReminders.js');
const { listNotificationsForUser } = await import('../src/db/userNotifications.js');
const { notifyMatchEvent } = await import('../src/jobs/notifier.js');

const REMINDER_ONLY_USER = '300000000000000001';
const FOLLOW_AND_REMINDER_USER = '300000000000000002';
const OTHER_USER = '300000000000000003';

let tournament;
let scheduledMatch;

test.before(async () => {
  tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'reminders/cup',
    game: 'valorant',
    name: 'Reminder Cup',
    url: 'https://liquipedia.net/valorant/Reminder_Cup',
    guild_id: 'guild-reminders',
  });
  scheduledMatch = await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:reminder-scheduled',
    team_a: 'Team Falcons',
    team_b: 'Team Liquid',
    status: 'scheduled',
    scheduled_at: 1_900_000_000,
  });
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('reminders persist by user and numeric match id, are idempotent, and honor cancellation ownership', async () => {
  assert.equal(await getMatchReminderTarget(999_999), null);
  assert.deepEqual(await listActiveReminderMatchIdsForUser(REMINDER_ONLY_USER, [scheduledMatch.id]), []);

  const first = await upsertMatchReminder({ discordUserId: REMINDER_ONLY_USER, matchId: scheduledMatch.id });
  const duplicate = await upsertMatchReminder({ discordUserId: REMINDER_ONLY_USER, matchId: scheduledMatch.id });
  assert.equal(first.discord_user_id, REMINDER_ONLY_USER);
  assert.equal(first.match_id, scheduledMatch.id);
  assert.equal(first.canceled_at, null);
  assert.equal(duplicate.created_at, first.created_at);
  assert.deepEqual(await listActiveReminderMatchIdsForUser(REMINDER_ONLY_USER, [scheduledMatch.id]), [scheduledMatch.id]);
  assert.deepEqual(await listActiveReminderUserIdsForMatch(scheduledMatch.id), [REMINDER_ONLY_USER]);

  assert.equal(await cancelMatchReminder({ discordUserId: OTHER_USER, matchId: scheduledMatch.id }), null);
  const canceled = await cancelMatchReminder({ discordUserId: REMINDER_ONLY_USER, matchId: scheduledMatch.id });
  assert.ok(canceled?.canceled_at);
  assert.equal(await cancelMatchReminder({ discordUserId: REMINDER_ONLY_USER, matchId: scheduledMatch.id }), null);
  assert.deepEqual(await listActiveReminderMatchIdsForUser(REMINDER_ONLY_USER, [scheduledMatch.id]), []);

  const restored = await upsertMatchReminder({ discordUserId: REMINDER_ONLY_USER, matchId: scheduledMatch.id });
  assert.equal(restored.canceled_at, null);
  assert.deepEqual(await listActiveReminderMatchIdsForUser(REMINDER_ONLY_USER, [scheduledMatch.id]), [scheduledMatch.id]);
});

test('active reminders receive start and result notifications without follows', async () => {
  const started = await notifyMatchEvent(null, 'started', scheduledMatch);
  const finished = await notifyMatchEvent(null, 'finished', {
    ...scheduledMatch,
    status: 'finished',
    score_a: 2,
    score_b: 1,
  });
  assert.equal(started.notified, 1);
  assert.equal(finished.notified, 1);
  assert.deepEqual(
    (await listNotificationsForUser(REMINDER_ONLY_USER)).map((notification) => notification.type).sort(),
    ['match_result', 'match_start'],
  );
});

test('a follow and reminder for the same match enqueue one notification', async () => {
  const match = await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:reminder-dedupe',
    team_a: 'Team Falcons',
    team_b: 'Team Liquid',
    status: 'scheduled',
    scheduled_at: 1_900_000_060,
  });
  await upsertFollow({
    discordUserId: FOLLOW_AND_REMINDER_USER,
    entityType: 'tournament',
    entityKey: String(tournament.id),
  });
  await upsertMatchReminder({ discordUserId: FOLLOW_AND_REMINDER_USER, matchId: match.id });

  const result = await notifyMatchEvent(null, 'started', match);
  assert.equal(result.notified, 1);
  const notifications = await listNotificationsForUser(FOLLOW_AND_REMINDER_USER);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'match_start');
});
