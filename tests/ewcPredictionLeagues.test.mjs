import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-prediction-leagues-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  archivePredictionLeague,
  createPredictionLeague,
  getPredictionLeagueForMember,
  joinPredictionLeague,
  leavePredictionLeague,
  listPredictionLeaguesForMember,
  predictionLeagueLeaderboard,
} = await import('../src/db/ewcPredictionLeagues.js');
const {
  saveWeeklyPredictionScore,
  setEwcWeekStatus,
  upsertEwcSeason,
  upsertEwcWeek,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('mini-league lifecycle enforces private membership and owner boundaries', async () => {
  const guildId = 'league-guild-lifecycle';
  const season = '2026';
  const owner = 'league-owner';
  const member = 'league-member';
  const outsider = 'league-outsider';
  const created = await createPredictionLeague({ guildId, season, ownerUserId: owner, name: 'Falcons Friends' });

  assert.equal(created.created, true);
  assert.ok(created.league);
  assert.match(created.league.inviteCode, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(created.league.memberCount, 1);

  const ownerList = await listPredictionLeaguesForMember({ guildId, season, userId: owner });
  assert.equal(ownerList.length, 1);
  assert.equal(ownerList[0].inviteCode, created.league.inviteCode);
  assert.deepEqual(await joinPredictionLeague({ guildId, season, userId: member, inviteCode: 'not-a-valid-invite-code' }), {
    joined: false,
    reason: 'invalid_invite',
    league: null,
  });

  const joined = await joinPredictionLeague({ guildId, season, userId: member, inviteCode: created.league.inviteCode });
  assert.equal(joined.joined, true);
  assert.equal(joined.league.inviteCode, null, 'members cannot read the owner invite code');
  assert.equal((await joinPredictionLeague({ guildId, season, userId: member, inviteCode: created.league.inviteCode })).reason, 'already_member');
  assert.equal((await getPredictionLeagueForMember({ guildId, season, userId: outsider, leagueId: created.league.id })), null);

  assert.deepEqual(await leavePredictionLeague({ guildId, season, userId: owner, leagueId: created.league.id }), {
    left: false,
    reason: 'owner_cannot_leave',
  });
  assert.equal((await leavePredictionLeague({ guildId, season, userId: member, leagueId: created.league.id })).left, true);
  assert.equal((await joinPredictionLeague({ guildId, season, userId: member, inviteCode: created.league.inviteCode })).joined, true);

  assert.equal(await archivePredictionLeague({ guildId, season, ownerUserId: outsider, leagueId: created.league.id }), false);
  assert.equal(await archivePredictionLeague({ guildId, season, ownerUserId: owner, leagueId: created.league.id }), true);
  assert.deepEqual(await listPredictionLeaguesForMember({ guildId, season, userId: owner }), []);
  assert.equal((await joinPredictionLeague({ guildId, season, userId: outsider, inviteCode: created.league.inviteCode })).reason, 'invalid_invite');
});

test('mini-league leaderboard filters official totals and includes eligible zero-point members', async () => {
  const guildId = 'league-guild-rankings';
  const season = '2027';
  const owner = 'league-rank-owner';
  const tiedMember = 'league-rank-tied';
  const zeroMember = 'league-rank-zero';
  const unscoredMember = 'league-rank-unscored';
  const inactiveMember = 'league-rank-inactive';
  await upsertEwcSeason({ guildId, season, label: 'Rank season', createdBy: 'test' });
  const created = await createPredictionLeague({ guildId, season, ownerUserId: owner, name: 'Ranked Friends' });
  for (const userId of [tiedMember, zeroMember, unscoredMember, inactiveMember]) {
    assert.equal((await joinPredictionLeague({ guildId, season, userId, inviteCode: created.league.inviteCode })).joined, true);
  }

  const week = await upsertEwcWeek({ guildId, season, weekKey: 'ranked-week', label: 'Ranked week', createdBy: 'test' });
  for (const userId of [owner, tiedMember, zeroMember, unscoredMember]) {
    await upsertWeeklyPrediction({ guildId, weekId: week.id, userId, picks: [`Pick ${userId}`] });
  }
  await saveWeeklyPredictionScore(guildId, week.id, owner, 100, { total: 100 });
  await saveWeeklyPredictionScore(guildId, week.id, tiedMember, 100, { total: 100 });
  await saveWeeklyPredictionScore(guildId, week.id, zeroMember, 0, { total: 0 });
  await setEwcWeekStatus(week.id, 'scored');

  const rows = await predictionLeagueLeaderboard({ guildId, season, leagueId: created.league.id });
  assert.deepEqual(rows.map((row) => [row.userId, row.score, row.rank]), [
    [owner, 100, 1],
    [tiedMember, 100, 1],
    [unscoredMember, 0, 3],
    [zeroMember, 0, 3],
  ]);
  assert.ok(!rows.some((row) => row.userId === inactiveMember));
});
