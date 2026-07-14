import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'follow-notifications-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.EWC_DASHBOARD_PUBLIC_URL = 'https://example.test';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch, getMatch } = await import('../src/db/matches.js');
const { run } = await import('../src/db/client.js');
const { upsertTeam } = await import('../src/db/teams.js');
const { upsertPlayer } = await import('../src/db/players.js');
const {
  upsertFollow,
  deleteFollow,
  listFollowsForUser,
  listFollowersForMatch,
  listFollowerIdsForMatch,
  listPersonalizedMatchesForUser,
  updateFollowNotificationOverrides,
} = await import('../src/db/userFollows.js');
const {
  enqueueNotifications,
  getNotificationPrefs,
  upsertNotificationPrefs,
  listNotificationPageForUser,
  listNotificationsForUser,
  listUnreadNotificationsForUser,
  listPendingDmNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = await import('../src/db/userNotifications.js');
const { notifyMatchEvent, drainDmQueue } = await import('../src/jobs/notifier.js');

const GUILD = 'guild-follow';
const GAME_FAN = '200000000000000001';
const TOURN_FAN = '200000000000000002';
const TEAM_FAN = '200000000000000003';
const PLAYER_FAN = '200000000000000004';
const QUIET_FAN = '200000000000000005';
const PAGE_FAN = '200000000000000009';

let tournament;
let match;

test.before(async () => {
  tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'follow/example',
    game: 'valorant',
    name: 'Follow Cup',
    url: 'https://liquipedia.net/valorant/Follow/Cup',
    guild_id: GUILD,
  });
  match = await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:follow-1',
    team_a: 'Team Liquid',
    team_b: 'Karmine Corp',
    score_a: null,
    score_b: null,
    status: 'running',
    scheduled_at: Math.floor(Date.now() / 1000) - 60,
  });

  const team = await upsertTeam({ game: 'valorant', pandascore_id: 501, name: 'Karmine Corp' });
  await upsertPlayer({
    game: 'valorant',
    pandascore_id: 601,
    name: 'FollowedPlayer',
    current_team_id: team.id,
    current_team_pandascore_id: 501,
    current_team_name: 'Karmine Corp',
  });

  await upsertFollow({ discordUserId: GAME_FAN, entityType: 'game', entityKey: 'Valorant', entityLabel: 'Valorant' });
  await upsertFollow({ discordUserId: TOURN_FAN, entityType: 'tournament', entityKey: String(tournament.id), entityLabel: 'Follow Cup' });
  // Team keys normalize: "team liquid!" and "Team Liquid" must collide.
  await upsertFollow({ discordUserId: TEAM_FAN, entityType: 'team', entityKey: 'team liquid!', entityLabel: 'Team Liquid' });
  const player = await (await import('../src/db/players.js')).getPlayerByPandaScoreId(601);
  await upsertFollow({ discordUserId: PLAYER_FAN, entityType: 'player', entityKey: String(player.id), entityLabel: 'FollowedPlayer' });
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('fan-out reaches game, tournament, team, and player followers exactly once', async () => {
  const ids = await listFollowerIdsForMatch({
    game: 'valorant',
    tournamentId: tournament.id,
    teamA: 'Team Liquid',
    teamB: 'Karmine Corp',
  });
  assert.deepEqual(ids.sort(), [GAME_FAN, TOURN_FAN, TEAM_FAN, PLAYER_FAN].sort());
});

test('per-follow event overrides use OR semantics across every matching follow', async () => {
  const OVERRIDE_FAN = '200000000000000011';
  const ALL_OFF_FAN = '200000000000000012';
  await Promise.all([
    upsertFollow({ discordUserId: OVERRIDE_FAN, entityType: 'game', entityKey: 'valorant' }),
    upsertFollow({ discordUserId: OVERRIDE_FAN, entityType: 'team', entityKey: 'Team Liquid' }),
    upsertFollow({ discordUserId: ALL_OFF_FAN, entityType: 'game', entityKey: 'valorant' }),
    upsertFollow({ discordUserId: ALL_OFF_FAN, entityType: 'team', entityKey: 'Team Liquid' }),
  ]);
  await Promise.all([
    upsertNotificationPrefs(OVERRIDE_FAN, { notifyMatchStart: false }),
    upsertNotificationPrefs(ALL_OFF_FAN, { notifyMatchStart: true }),
  ]);
  for (const follow of await listFollowsForUser(OVERRIDE_FAN)) {
    await updateFollowNotificationOverrides({
      discordUserId: OVERRIDE_FAN,
      followId: follow.id,
      notifyMatchStart: follow.entity_type === 'team',
    });
  }
  for (const follow of await listFollowsForUser(ALL_OFF_FAN)) {
    await updateFollowNotificationOverrides({ discordUserId: ALL_OFF_FAN, followId: follow.id, notifyMatchStart: false });
  }

  const recipients = await listFollowersForMatch({
    game: 'valorant',
    tournamentId: tournament.id,
    teamA: 'Team Liquid',
    teamB: 'Karmine Corp',
  });
  const overrideRecipient = recipients.find((recipient) => recipient.discordUserId === OVERRIDE_FAN);
  assert.equal(overrideRecipient.follows.length, 2);
  const policyRecipients = recipients.filter((recipient) => [OVERRIDE_FAN, ALL_OFF_FAN].includes(recipient.discordUserId));
  assert.equal((await enqueueNotifications({
    recipients: policyRecipients,
    type: 'match_start',
    matchId: match.id,
    title: 'Override match',
    dedupeKey: 'match_start:test:override-or',
    nowSec: 1_800_000_000,
  })), 1); // OVERRIDE_FAN is enabled by its team override; ALL_OFF_FAN is not.
  assert.equal((await listNotificationsForUser(OVERRIDE_FAN)).length, 1);
  assert.equal((await listNotificationsForUser(ALL_OFF_FAN)).length, 0);
  await Promise.all([
    deleteFollow({ discordUserId: OVERRIDE_FAN, entityType: 'game', entityKey: 'valorant' }),
    deleteFollow({ discordUserId: OVERRIDE_FAN, entityType: 'team', entityKey: 'Team Liquid' }),
    deleteFollow({ discordUserId: ALL_OFF_FAN, entityType: 'game', entityKey: 'valorant' }),
    deleteFollow({ discordUserId: ALL_OFF_FAN, entityType: 'team', entityKey: 'Team Liquid' }),
  ]);
});

test('enqueue captures instant quiet-hour and daily-digest delivery timestamps', async () => {
  const SCHEDULE_FAN = '200000000000000013';
  const now = Math.floor(Date.UTC(2026, 0, 2, 21, 30) / 1000); // 00:30 Riyadh
  await upsertNotificationPrefs(SCHEDULE_FAN, {
    timezone: 'Asia/Riyadh',
    quietStartMinute: 23 * 60,
    quietEndMinute: 7 * 60,
  });
  await enqueueNotifications({
    userIds: [SCHEDULE_FAN],
    type: 'match_start',
    matchId: match.id,
    title: 'Quiet instant',
    dedupeKey: 'match_start:test:quiet-instant',
    nowSec: now,
  });
  const instant = (await listNotificationsForUser(SCHEDULE_FAN)).find((row) => row.dedupe_key === 'match_start:test:quiet-instant');
  assert.equal(instant.dm_delivery_mode, 'instant');
  assert.equal(instant.dm_not_before, Math.floor(Date.UTC(2026, 0, 3, 4) / 1000));

  await upsertNotificationPrefs(SCHEDULE_FAN, {
    dmDeliveryMode: 'daily_digest',
    quietStartMinute: null,
    quietEndMinute: null,
    digestMinute: 18 * 60,
  });
  await enqueueNotifications({
    userIds: [SCHEDULE_FAN],
    type: 'match_result',
    matchId: match.id,
    title: 'Daily digest',
    dedupeKey: 'match_result:test:daily-digest',
    nowSec: now,
  });
  const digest = (await listNotificationsForUser(SCHEDULE_FAN)).find((row) => row.dedupe_key === 'match_result:test:daily-digest');
  assert.equal(digest.dm_delivery_mode, 'daily_digest');
  assert.equal(digest.dm_not_before, Math.floor(Date.UTC(2026, 0, 3, 15) / 1000));
  await run("UPDATE user_notifications SET dm_status = 'skipped' WHERE discord_user_id = $1", [SCHEDULE_FAN]);
});

test('a tournament follow created by Discord uses the shared notification fan-out', async () => {
  const DISCORD_COMMAND_FAN = '200000000000000010';
  const { execute: executeFollow } = await import('../src/commands/follow.js');
  const interaction = {
    guildId: GUILD,
    locale: 'en-US',
    user: { id: DISCORD_COMMAND_FAN },
    options: {
      getSubcommand: () => 'tournament',
      getString: () => null,
      getInteger: () => tournament.id,
    },
    replies: [],
    async reply(payload) {
      this.replies.push(payload);
    },
  };

  await executeFollow(interaction);
  assert.equal(interaction.replies[0].flags, 64);
  const ids = await listFollowerIdsForMatch({
    game: 'valorant',
    tournamentId: tournament.id,
    teamA: 'Team Liquid',
    teamB: 'Karmine Corp',
  });
  assert.ok(ids.includes(DISCORD_COMMAND_FAN));
  await deleteFollow({
    discordUserId: DISCORD_COMMAND_FAN,
    entityType: 'tournament',
    entityKey: String(tournament.id),
  });
});

test('unrelated matches reach no one', async () => {
  const ids = await listFollowerIdsForMatch({
    game: 'dota2',
    tournamentId: 999999,
    teamA: 'Alpha',
    teamB: 'Bravo',
  });
  assert.deepEqual(ids, []);
});

test('unfollow removes the user from fan-out', async () => {
  await upsertFollow({ discordUserId: QUIET_FAN, entityType: 'game', entityKey: 'valorant' });
  await deleteFollow({ discordUserId: QUIET_FAN, entityType: 'game', entityKey: 'valorant' });
  const ids = await listFollowerIdsForMatch({
    game: 'valorant',
    tournamentId: tournament.id,
    teamA: 'Team Liquid',
    teamB: 'Karmine Corp',
  });
  assert.ok(!ids.includes(QUIET_FAN));
  assert.equal((await listFollowsForUser(QUIET_FAN)).length, 0);
});

test('notifyMatchEvent enqueues deduped notifications and honors prefs', async () => {
  // QUIET_FAN follows the game but has match-start notifications off.
  await upsertFollow({ discordUserId: QUIET_FAN, entityType: 'game', entityKey: 'valorant' });
  await upsertNotificationPrefs(QUIET_FAN, { notifyMatchStart: false });

  const row = await getMatch('liquipedia', 'Match:follow-1');
  const first = await notifyMatchEvent(null, 'started', row);
  assert.equal(first.notified, 4); // everyone but QUIET_FAN

  // Same transition again (poll churn): dedupe key blocks every insert.
  const second = await notifyMatchEvent(null, 'started', row);
  assert.equal(second.notified, 0);

  // 'update' events (score ticks) never notify.
  assert.equal(await notifyMatchEvent(null, 'update', row), null);

  const inbox = await listNotificationsForUser(GAME_FAN);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].type, 'match_start');
  assert.equal(inbox[0].title, 'Team Liquid vs Karmine Corp');
  assert.equal(inbox[0].body, 'Follow Cup');
  assert.equal(inbox[0].url, `https://example.test/tournaments/${tournament.id}`);
  assert.equal(inbox[0].dm_status, 'pending');

  assert.equal((await listNotificationsForUser(QUIET_FAN)).length, 0);
});

test('dm_enabled=false keeps the inbox row but never queues a DM', async () => {
  await upsertNotificationPrefs(TEAM_FAN, { dmEnabled: false });
  await enqueueNotifications({
    userIds: [TEAM_FAN],
    type: 'match_result',
    matchId: match.id,
    title: 'Team Liquid 2–1 Karmine Corp',
    dedupeKey: 'match_result:test:manual-1',
  });
  const inbox = await listNotificationsForUser(TEAM_FAN);
  const manual = inbox.find((n) => n.dedupe_key === 'match_result:test:manual-1');
  assert.equal(manual.dm_status, 'skipped');
});

test('notification pages use a sentinel without crossing user ownership', async () => {
  await upsertNotificationPrefs(PAGE_FAN, { dmEnabled: false });
  for (let index = 1; index <= 5; index += 1) {
    await enqueueNotifications({
      userIds: [PAGE_FAN],
      type: 'match_start',
      matchId: match.id,
      title: `Page notification ${index}`,
      dedupeKey: `match_start:test:page-${index}`,
    });
  }

  const first = await listNotificationPageForUser(PAGE_FAN, { limit: 2 });
  const middle = await listNotificationPageForUser(PAGE_FAN, { limit: 2, offset: 2 });
  const final = await listNotificationPageForUser(PAGE_FAN, { limit: 2, offset: 4 });
  assert.equal(first.nextOffset, 2);
  assert.equal(middle.nextOffset, 4);
  assert.equal(final.nextOffset, null);
  assert.deepEqual(
    [...first.notifications, ...middle.notifications, ...final.notifications].map((row) => row.id),
    [...new Set([...first.notifications, ...middle.notifications, ...final.notifications].map((row) => row.id))],
  );
  assert.ok(
    [...first.notifications, ...middle.notifications, ...final.notifications].every(
      (row) => row.discord_user_id === PAGE_FAN,
    ),
  );
});

test('drainDmQueue delivers pending DMs, marks closed DMs skipped and errors failed', async () => {
  const sent = [];
  const client = {
    users: {
      fetch: async (id) => {
        if (id === TOURN_FAN) {
          const err = new Error('Cannot send messages to this user');
          err.code = 50007;
          throw err;
        }
        if (id === PLAYER_FAN) throw new Error('network blip');
        return {
          send: async (payload) => {
            sent.push({ id, content: payload.content });
          },
        };
      },
    },
  };

  const summary = await drainDmQueue(client, { gapMs: 0 });
  // GAME_FAN + TEAM_FAN deliver (TEAM_FAN's match-start row was queued before
  // its dm_enabled=false pref change; enqueue-time status is intentional).
  assert.equal(summary.sent, 2);
  assert.equal(summary.skipped, 1); // TOURN_FAN (DMs closed)
  assert.equal(summary.failed, 1); // PLAYER_FAN (transient error)
  assert.equal((await listPendingDmNotifications()).length, 0);

  assert.deepEqual(sent.map((s) => s.id).sort(), [GAME_FAN, TEAM_FAN].sort());
  const dm = sent[0].content;
  assert.match(dm, /LIVE/);
  assert.match(dm, /Team Liquid vs Karmine Corp/);
  assert.match(dm, /Follow Cup/);
  assert.match(dm, /Manage notifications/);
});

test('read tracking: unread count, single mark-read, and mark-all-read', async () => {
  const unread = await countUnreadNotifications(GAME_FAN);
  assert.ok(unread >= 1);
  const first = (await listNotificationsForUser(GAME_FAN)).find((row) => row.read_at === null);
  assert.ok(first, 'expected at least one unread notification');
  assert.equal(await markNotificationRead(GAME_FAN, first.id), 1);
  assert.equal(await markNotificationRead(GAME_FAN, first.id), 0);
  assert.equal(await countUnreadNotifications(GAME_FAN), unread - 1);

  const marked = await markAllNotificationsRead(GAME_FAN);
  assert.equal(marked, unread - 1);
  assert.equal(await countUnreadNotifications(GAME_FAN), 0);
});

test('prefs default sensibly for users with no row', async () => {
  const prefs = await getNotificationPrefs('999999999999999999');
  assert.equal(prefs.dm_enabled, 1);
  assert.equal(prefs.notify_match_start, 1);
  assert.equal(prefs.notify_match_result, 1);
});

test('a non-numeric player follow key never breaks or joins the fan-out', async () => {
  const BAD_FAN = '200000000000000006';
  await upsertFollow({ discordUserId: BAD_FAN, entityType: 'player', entityKey: 'abc' });
  const ids = await listFollowerIdsForMatch({
    game: 'valorant',
    tournamentId: tournament.id,
    teamA: 'Team Liquid',
    teamB: 'Karmine Corp',
  });
  assert.ok(ids.length > 0); // fan-out survives the bad row
  assert.ok(!ids.includes(BAD_FAN));
  await deleteFollow({ discordUserId: BAD_FAN, entityType: 'player', entityKey: 'abc' });
});

test('player follows are game-gated: same team name in another game does not notify', async () => {
  const CROSS_FAN = '200000000000000007';
  const otherTeam = await upsertTeam({ game: 'dota2', pandascore_id: 502, name: 'Karmine Corp' });
  const otherPlayer = await upsertPlayer({
    game: 'dota2',
    pandascore_id: 602,
    name: 'DotaPlayer',
    current_team_id: otherTeam.id,
    current_team_pandascore_id: 502,
    current_team_name: 'Karmine Corp',
  });
  await upsertFollow({ discordUserId: CROSS_FAN, entityType: 'player', entityKey: String(otherPlayer.id) });

  const valorantIds = await listFollowerIdsForMatch({
    game: 'valorant',
    tournamentId: tournament.id,
    teamA: 'Team Liquid',
    teamB: 'Karmine Corp',
  });
  assert.ok(!valorantIds.includes(CROSS_FAN)); // dota2 player, valorant match

  const dotaIds = await listFollowerIdsForMatch({
    game: 'dota2',
    tournamentId: 999998,
    teamA: 'Karmine Corp',
    teamB: 'Someone Else',
  });
  assert.ok(dotaIds.includes(CROSS_FAN)); // their own game still notifies
});

test('partial pref patches never clobber the other fields', async () => {
  const PREF_USER = '200000000000000008';
  await upsertNotificationPrefs(PREF_USER, { dmEnabled: false });
  const after = await upsertNotificationPrefs(PREF_USER, { notifyMatchStart: false });
  assert.equal(after.dm_enabled, 0); // survived the second, unrelated patch
  assert.equal(after.notify_match_start, 0);
  assert.equal(after.notify_match_result, 1);
});

test('follow quota: creation stops at the cap but re-follow stays idempotent', async () => {
  const { upsertFollow, listFollowsForUser, MAX_FOLLOWS_PER_USER } = await import('../src/db/userFollows.js');
  const userId = '900000000000000777';
  for (let i = 0; i < MAX_FOLLOWS_PER_USER; i += 1) {
    const created = await upsertFollow({ discordUserId: userId, entityType: 'team', entityKey: `Quota Team ${i}` });
    assert.equal(created.limited ?? undefined, undefined);
  }
  const over = await upsertFollow({ discordUserId: userId, entityType: 'team', entityKey: 'One Team Too Many' });
  assert.deepEqual(over, { limited: true });
  // Re-following an existing target at the cap remains an idempotent update.
  const again = await upsertFollow({ discordUserId: userId, entityType: 'team', entityKey: 'Quota Team 0', entityLabel: 'renamed' });
  assert.equal(again.limited ?? undefined, undefined);
  const rows = await listFollowsForUser(userId);
  assert.equal(rows.length, MAX_FOLLOWS_PER_USER);
});

test('concurrent follow writes cannot race past the per-user quota', async () => {
  const { upsertFollow, listFollowsForUser, MAX_FOLLOWS_PER_USER } = await import('../src/db/userFollows.js');
  const userId = '900000000000000778';
  const attempts = Array.from({ length: MAX_FOLLOWS_PER_USER + 25 }, (_, i) =>
    upsertFollow({ discordUserId: userId, entityType: 'team', entityKey: `Concurrent Team ${i}` }),
  );

  const results = await Promise.all(attempts);
  const rows = await listFollowsForUser(userId);
  assert.equal(rows.length, MAX_FOLLOWS_PER_USER);
  assert.equal(results.filter((result) => result?.limited).length, 25);
});

test('personalized match selection covers every follow type with bounded, deduped activity', async () => {
  const now = 2_000_000_000;
  const gameFan = '200000000000000101';
  const tournamentFan = '200000000000000102';
  const teamFan = '200000000000000103';
  const playerFan = '200000000000000104';
  const allFan = '200000000000000105';
  const todayTournament = await addTournament({
    source: 'liquipedia',
    external_id: 'today-for-you/cup',
    game: 'valorant',
    name: 'Today For You Cup',
    url: 'https://liquipedia.net/valorant/Today_For_You/Cup',
    guild_id: GUILD,
  });
  const archivedTournament = await addTournament({
    source: 'liquipedia',
    external_id: 'today-for-you/archived',
    game: 'valorant',
    name: 'Archived Today Cup',
    url: 'https://liquipedia.net/valorant/Today_For_You/Archived',
    guild_id: GUILD,
  });
  await run('UPDATE tournaments SET archived_at = $1 WHERE id = $2', [now, archivedTournament.id]);

  const playerTeam = await upsertTeam({ game: 'valorant', pandascore_id: 9501, name: 'Player Team' });
  const personalizedPlayer = await upsertPlayer({
    game: 'valorant',
    pandascore_id: 9601,
    name: 'Today Player',
    current_team_id: playerTeam.id,
    current_team_pandascore_id: 9501,
    current_team_name: 'Player Team',
  });
  const createMatch = (externalId, patch = {}) => upsertMatch({
    tournament_id: todayTournament.id,
    source: 'liquipedia',
    external_id: externalId,
    team_a: 'Team Liquid',
    team_b: 'Player Team',
    score_a: null,
    score_b: null,
    status: 'running',
    scheduled_at: now - 60,
    ...patch,
  });
  const allCriteria = await createMatch('Match:today-all');
  const secondLive = await createMatch('Match:today-live-2', { scheduled_at: now - 30 });
  await createMatch('Match:today-live-3', { scheduled_at: now - 10 });
  const firstUpcoming = await createMatch('Match:today-upcoming-1', {
    status: 'scheduled',
    scheduled_at: now + 60,
  });
  const placeholderUpcoming = await createMatch('Match:today-placeholder', {
    team_b: 'TBD',
    status: 'scheduled',
    scheduled_at: now + 120,
  });
  await createMatch('Match:today-outside-window', { status: 'scheduled', scheduled_at: now + 8 * 24 * 60 * 60 });
  await createMatch('Match:today-past', { status: 'scheduled', scheduled_at: now - 1 });
  await upsertMatch({
    tournament_id: archivedTournament.id,
    source: 'liquipedia',
    external_id: 'Match:today-archived',
    team_a: 'Team Liquid',
    team_b: 'Player Team',
    status: 'running',
    scheduled_at: now - 60,
  });

  await upsertFollow({ discordUserId: gameFan, entityType: 'game', entityKey: 'valorant' });
  await upsertFollow({ discordUserId: tournamentFan, entityType: 'tournament', entityKey: String(todayTournament.id) });
  await upsertFollow({ discordUserId: teamFan, entityType: 'team', entityKey: 'team liquid!' });
  await upsertFollow({ discordUserId: playerFan, entityType: 'player', entityKey: String(personalizedPlayer.id) });
  await Promise.all([
    upsertFollow({ discordUserId: allFan, entityType: 'game', entityKey: 'valorant' }),
    upsertFollow({ discordUserId: allFan, entityType: 'tournament', entityKey: String(todayTournament.id) }),
    upsertFollow({ discordUserId: allFan, entityType: 'team', entityKey: 'Team Liquid' }),
    upsertFollow({ discordUserId: allFan, entityType: 'player', entityKey: String(personalizedPlayer.id) }),
  ]);

  for (const userId of [gameFan, tournamentFan, teamFan, playerFan]) {
    const selected = await listPersonalizedMatchesForUser(userId, { nowSec: now });
    assert.ok(selected.live.some((row) => row.id === allCriteria.id), `expected ${userId} to see the matching live match`);
  }

  const selected = await listPersonalizedMatchesForUser(allFan, { nowSec: now, liveLimit: 2, upcomingLimit: 2 });
  assert.deepEqual(selected.live.map((row) => row.id), [allCriteria.id, secondLive.id]);
  assert.deepEqual(selected.upcoming.map((row) => row.id), [firstUpcoming.id, placeholderUpcoming.id]);
  assert.equal(selected.live.filter((row) => row.id === allCriteria.id).length, 1);
  assert.equal(selected.live.length, 2);
  assert.equal(selected.upcoming.length, 2);
  assert.ok(selected.upcoming.some((row) => row.teamB === 'TBD'));
  assert.ok(![...selected.live, ...selected.upcoming].some((row) => row.tournamentName === 'Archived Today Cup'));
});

test('unread notification reads stay member-scoped and bounded', async () => {
  const userId = '200000000000000106';
  for (let index = 1; index <= 4; index += 1) {
    await enqueueNotifications({
      userIds: [userId],
      type: 'match_result',
      matchId: match.id,
      title: `Unread result ${index}`,
      dedupeKey: `unread-result:${index}`,
    });
  }
  const unread = await listUnreadNotificationsForUser(userId, { limit: 3 });
  assert.equal(unread.length, 3);
  assert.ok(unread.every((row) => row.discord_user_id === userId && row.read_at === null));
});
