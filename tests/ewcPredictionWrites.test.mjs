import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-prediction-writes-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  getSeasonPrediction,
  getWeeklyPrediction,
  setEwcWeekStatus,
  upsertEwcSeason,
  upsertEwcWeek,
  upsertWeeklyGamePick,
} = await import('../src/db/ewcPredictions.js');
const { scorePerGameWeeklyPrediction } = await import('../src/lib/ewcPredictions.js');
const {
  submitSeasonSlot,
  submitWeeklyGamePick,
  swapSeasonPicks,
} = await import('../src/lib/ewcPredictionWrites.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function resolverBarrier(count = 2) {
  const waiters = [];
  return async () => {
    await new Promise((resolve) => {
      waiters.push(resolve);
      if (waiters.length === count) waiters.splice(0).forEach((release) => release());
    });
  };
}

const immediateResolvers = {
  participants: async () => [],
  club: async (rawPick) => ({ ok: true, name: rawPick }),
};

async function openWeek(guildId, weekKey, games, { status = 'open' } = {}) {
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey,
    label: weekKey,
    openAt: 10,
    closeAt: 1_000,
    games,
    createdBy: 'admin',
  });
  if (status !== 'open') await setEwcWeekStatus(week.id, status);
  return week;
}

function weeklyInput(guildId, weekKey, gameKey, rawPick, submittedAt = 100, resolvers = immediateResolvers) {
  return {
    guildId,
    season: '2026',
    userId: '200000000000000001',
    weekKey,
    gameKey,
    rawPick,
    submittedAt,
    resolvers,
  };
}

test('concurrent weekly changes preserve different game picks and exactly one first-pick result', async () => {
  const guildId = 'guild-write-weekly-concurrent';
  const week = await openWeek(guildId, 'week-concurrent', [
    { key: 'game-a', game: 'Game A', lockAt: 500 },
    { key: 'game-b', game: 'Game B', lockAt: 500 },
  ]);
  const barrier = resolverBarrier();
  const resolvers = { ...immediateResolvers, club: async (rawPick) => {
    await barrier();
    return { ok: true, name: rawPick };
  } };

  const results = await Promise.all([
    submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-a', 'Falcons', 100, resolvers)),
    submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-b', 'Liquid', 100, resolvers)),
  ]);

  assert.deepEqual(results.map((result) => result.ok), [true, true]);
  assert.equal(results.filter((result) => result.firstPick).length, 1);
  const saved = await getWeeklyPrediction(guildId, week.id, '200000000000000001');
  assert.deepEqual(saved.picks.map((pick) => pick.gameKey).toSorted(), ['game-a', 'game-b']);
});

test('replacing one weekly game preserves every other game', async () => {
  const guildId = 'guild-write-weekly-replace';
  const week = await openWeek(guildId, 'week-replace', [
    { key: 'game-a', game: 'Game A', lockAt: 500 },
    { key: 'game-b', game: 'Game B', lockAt: 500 },
  ]);
  await submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-a', 'Falcons'));
  await submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-b', 'Liquid'));
  await submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-a', 'Heretics'));

  const saved = await getWeeklyPrediction(guildId, week.id, '200000000000000001');
  assert.deepEqual(
    Object.fromEntries(saved.picks.map((pick) => [pick.gameKey, pick.pick])),
    { 'game-a': 'Heretics', 'game-b': 'Liquid' },
  );
});

test('trusted submission time stays valid through delayed resolution and rejects the exact lock boundary', async () => {
  const guildId = 'guild-write-lock-boundary';
  const week = await openWeek(guildId, 'week-lock-boundary', [{ key: 'game-a', game: 'Game A', lockAt: 500 }]);
  let resolveClub;
  let signalResolutionStarted;
  const resolutionStarted = new Promise((resolve) => { signalResolutionStarted = resolve; });
  const delayedResolvers = {
    ...immediateResolvers,
    club: (rawPick) => new Promise((resolve) => {
      resolveClub = () => resolve({ ok: true, name: rawPick });
      signalResolutionStarted();
    }),
  };
  const beforeLock = submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-a', 'Falcons', 499, delayedResolvers));
  await resolutionStarted;
  resolveClub();
  assert.equal((await beforeLock).ok, true);

  const locked = await submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-a', 'Late Club', 500));
  assert.deepEqual({ ok: locked.ok, code: locked.code }, { ok: false, code: 'locked' });
  const saved = await getWeeklyPrediction(guildId, week.id, '200000000000000001');
  assert.equal(saved.picks[0].pick, 'Falcons');
});

test('scored rounds reject writes without creating a prediction row', async () => {
  const guildId = 'guild-write-scored';
  const week = await openWeek(guildId, 'week-scored', [{ key: 'game-a', game: 'Game A', lockAt: 500 }], { status: 'scored' });
  const result = await submitWeeklyGamePick(weeklyInput(guildId, week.week_key, 'game-a', 'Falcons'));
  assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'round_closed' });
  assert.equal(await getWeeklyPrediction(guildId, week.id, '200000000000000001'), null);
});

test('concurrent season updates and swaps preserve every selected club', async () => {
  const guildId = 'guild-write-season-concurrent';
  await upsertEwcSeason({ guildId, season: '2026', label: 'Season', topSize: 4, openAt: 10, closeAt: 1_000, createdBy: 'admin' });
  const initial = await submitSeasonSlot({
    guildId, season: '2026', userId: '200000000000000001', index: 0, rawPick: 'Falcons', submittedAt: 100, resolvers: immediateResolvers,
  });
  assert.equal(initial.ok, true);
  await submitSeasonSlot({
    guildId, season: '2026', userId: '200000000000000001', index: 1, rawPick: 'Liquid', submittedAt: 100, resolvers: immediateResolvers,
  });
  const barrier = resolverBarrier();
  const resolvers = { ...immediateResolvers, club: async (rawPick) => {
    await barrier();
    return { ok: true, name: rawPick };
  } };
  const changed = await Promise.all([
    submitSeasonSlot({ guildId, season: '2026', userId: '200000000000000001', index: 0, rawPick: 'Heretics', submittedAt: 100, resolvers }),
    submitSeasonSlot({ guildId, season: '2026', userId: '200000000000000001', index: 1, rawPick: 'Spirit', submittedAt: 100, resolvers }),
  ]);
  assert.deepEqual(changed.map((result) => result.ok), [true, true]);
  await Promise.all([
    swapSeasonPicks({ guildId, season: '2026', userId: '200000000000000001', a: 0, b: 1, submittedAt: 100 }),
    swapSeasonPicks({ guildId, season: '2026', userId: '200000000000000001', a: 0, b: 1, submittedAt: 100 }),
  ]);
  const saved = await getSeasonPrediction(guildId, '2026', '200000000000000001');
  assert.deepEqual(saved.picks.toSorted(), ['Heretics', 'Spirit']);
});

test('late stored picks score zero while legacy picks without pickedAt remain compatible', () => {
  const games = [{ key: 'game-a', game: 'Game A', lockAt: 500 }];
  const results = [{ gameKey: 'game-a', placements: [{ club: 'Falcons', points: 1_000, place: '1st' }] }];
  const late = scorePerGameWeeklyPrediction([{ gameKey: 'game-a', pick: 'Falcons', pickedAt: 501 }], games, results);
  assert.equal(late.score, 0);
  assert.equal(late.details.picks[0].late, true);
  assert.equal(late.details.picks[0].points, 0);
  const legacy = scorePerGameWeeklyPrediction([{ gameKey: 'game-a', pick: 'Falcons' }], games, results);
  assert.equal(legacy.score, 1_000);
});

test('direct DB helper records the supplied trusted submission time', async () => {
  const guildId = 'guild-write-picked-at';
  const week = await openWeek(guildId, 'week-picked-at', [{ key: 'game-a', game: 'Game A', lockAt: 500 }]);
  await upsertWeeklyGamePick({
    guildId, weekId: week.id, userId: '200000000000000001', gameKey: 'game-a', game: 'Game A', pick: 'Falcons', pickedAt: 321,
  });
  const saved = await getWeeklyPrediction(guildId, week.id, '200000000000000001');
  assert.equal(saved.picks[0].pickedAt, 321);
});
