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
const { upsertTeam } = await import('../src/db/teams.js');
const { upsertPlayer } = await import('../src/db/players.js');
const {
  upsertFollow,
  deleteFollow,
  listFollowsForUser,
  listFollowerIdsForMatch,
} = await import('../src/db/userFollows.js');
const {
  enqueueNotifications,
  getNotificationPrefs,
  upsertNotificationPrefs,
  listNotificationsForUser,
  listPendingDmNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
} = await import('../src/db/userNotifications.js');
const { notifyMatchEvent, drainDmQueue } = await import('../src/jobs/notifier.js');

const GUILD = 'guild-follow';
const GAME_FAN = '200000000000000001';
const TOURN_FAN = '200000000000000002';
const TEAM_FAN = '200000000000000003';
const PLAYER_FAN = '200000000000000004';
const QUIET_FAN = '200000000000000005';

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

test('read tracking: unread count and mark-all-read', async () => {
  const unread = await countUnreadNotifications(GAME_FAN);
  assert.ok(unread >= 1);
  const marked = await markAllNotificationsRead(GAME_FAN);
  assert.equal(marked, unread);
  assert.equal(await countUnreadNotifications(GAME_FAN), 0);
});

test('prefs default sensibly for users with no row', async () => {
  const prefs = await getNotificationPrefs('999999999999999999');
  assert.equal(prefs.dm_enabled, 1);
  assert.equal(prefs.notify_match_start, 1);
  assert.equal(prefs.notify_match_result, 1);
});
