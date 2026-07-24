import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canonicalEwcEventIdentity,
  generateEwcWeekWindows,
  reconcileEwcPredictionGames,
  stableEwcGameKey,
} from '../src/lib/ewcPredictions.js';

const dbDir = mkdtempSync(join(tmpdir(), 'ewc-game-keys-'));
process.env.DB_PATH = join(dbDir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
const { closeDb } = await import('../src/db/index.js');
const {
  claimEwcPredictionReminder,
  getEwcPredictionReminder,
  getEwcWeek,
  getWeeklyPrediction,
  markEwcWeekScoredWithResults,
  releaseEwcPredictionReminderClaim,
  saveWeeklyPredictionScore,
  setEwcWeekResults,
  upsertEwcWeek,
  upsertWeeklyGamePick,
} = await import('../src/db/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dbDir, { recursive: true, force: true });
});

const JULY_7 = Math.floor(Date.parse('2026-07-07T09:00:00Z') / 1000);
const JULY_8 = Math.floor(Date.parse('2026-07-08T09:00:00Z') / 1000);
const JULY_9 = Math.floor(Date.parse('2026-07-09T09:00:00Z') / 1000);

function event(overrides = {}) {
  return {
    game: 'Valorant',
    gameWiki: 'valorant',
    event: 'Valorant at Esports World Cup 2026',
    eventUrl: 'https://liquipedia.net/valorant/Esports_World_Cup/2026',
    startAt: JULY_8,
    endAt: JULY_9,
    ...overrides,
  };
}

test('canonical identity prefers the normalized Liquipedia path and ignores dates', () => {
  const first = event();
  const corrected = event({
    eventUrl: 'https://liquipedia.net/VALORANT/Esports_World_Cup/2026/?utm_source=test#standings',
    startAt: JULY_7,
    endAt: JULY_8,
  });

  assert.equal(canonicalEwcEventIdentity(first), 'liquipedia:/valorant/esports_world_cup/2026');
  assert.equal(canonicalEwcEventIdentity(corrected), canonicalEwcEventIdentity(first));
  assert.equal(stableEwcGameKey(corrected), stableEwcGameKey(first));
  assert.match(stableEwcGameKey(first), /^[a-z0-9-]{1,32}$/);
});

test('generated keys remain stable when an earlier event is inserted or input is reordered', () => {
  const valorant = event();
  const dota = event({
    game: 'Dota 2',
    gameWiki: 'dota2',
    event: 'Dota 2 at Esports World Cup 2026',
    eventUrl: 'https://liquipedia.net/dota2/Esports_World_Cup/2026',
    startAt: JULY_7,
    endAt: JULY_8,
  });
  const chess = event({
    game: 'Chess',
    gameWiki: 'chess',
    event: 'Chess at Esports World Cup 2026',
    eventUrl: 'https://liquipedia.net/chess/Esports_World_Cup/2026',
    startAt: JULY_7,
    endAt: JULY_7 + 3600,
  });

  const original = generateEwcWeekWindows([dota, valorant]).flatMap((week) => week.events);
  const changed = generateEwcWeekWindows([valorant, chess, dota]).flatMap((week) => week.events);
  const originalByIdentity = new Map(original.map((game) => [game.eventIdentity, game.key]));
  const changedByIdentity = new Map(changed.map((game) => [game.eventIdentity, game.key]));

  assert.equal(changedByIdentity.get(canonicalEwcEventIdentity(valorant)), originalByIdentity.get(canonicalEwcEventIdentity(valorant)));
  assert.equal(changedByIdentity.get(canonicalEwcEventIdentity(dota)), originalByIdentity.get(canonicalEwcEventIdentity(dota)));
});

test('generation rejects duplicate or empty event identities', () => {
  assert.throws(
    () => generateEwcWeekWindows([event(), event({ startAt: JULY_7 })]),
    /Duplicate EWC prediction event identity/,
  );
  assert.throws(
    () => generateEwcWeekWindows([{ startAt: JULY_7, endAt: JULY_8 }]),
    /missing the fields required for a stable identity/,
  );
});

test('fallback identity distinguishes duplicate labels by game wiki and rejects true ambiguity', () => {
  const first = { key: 'old-a', game: 'Fighter Games', gameWiki: 'fatalfury', event: 'EWC 2026' };
  const second = { key: 'old-b', game: 'Fighter Games', gameWiki: 'streetfighter', event: 'EWC 2026' };
  assert.notEqual(canonicalEwcEventIdentity(first), canonicalEwcEventIdentity(second));

  const report = reconcileEwcPredictionGames(
    [first, { ...first, key: 'old-duplicate' }],
    [{ ...first, key: stableEwcGameKey(first), eventIdentity: canonicalEwcEventIdentity(first) }],
  );
  assert.equal(report.ok, false);
  assert.ok(report.ambiguous.some((entry) => entry.reason === 'duplicate-identity'));
});

test('reconciliation is bijective across reorders and additions without mutating inputs', () => {
  const oldValorant = { ...event(), key: 'valorant-2' };
  const oldDota = {
    ...event({
      game: 'Dota 2',
      gameWiki: 'dota2',
      event: 'Dota 2 at Esports World Cup 2026',
      eventUrl: 'https://liquipedia.net/dota2/Esports_World_Cup/2026',
    }),
    key: 'dota-1',
  };
  const stored = [oldDota, oldValorant];
  const regenerated = [
    { ...oldValorant, key: stableEwcGameKey(oldValorant), eventIdentity: canonicalEwcEventIdentity(oldValorant) },
    { ...oldDota, key: stableEwcGameKey(oldDota), eventIdentity: canonicalEwcEventIdentity(oldDota) },
    {
      ...event({
        game: 'Chess',
        gameWiki: 'chess',
        event: 'Chess at Esports World Cup 2026',
        eventUrl: 'https://liquipedia.net/chess/Esports_World_Cup/2026',
      }),
      key: stableEwcGameKey({ game: 'Chess', gameWiki: 'chess', event: 'Chess at Esports World Cup 2026', eventUrl: 'https://liquipedia.net/chess/Esports_World_Cup/2026' }),
      eventIdentity: canonicalEwcEventIdentity({ game: 'Chess', gameWiki: 'chess', event: 'Chess at Esports World Cup 2026', eventUrl: 'https://liquipedia.net/chess/Esports_World_Cup/2026' }),
    },
  ];
  const before = structuredClone({ stored, regenerated });

  const report = reconcileEwcPredictionGames(stored, regenerated, { referencedKeys: ['dota-1', 'valorant-2'] });

  assert.equal(report.ok, true);
  assert.equal(report.rekeyed.length, 2);
  assert.equal(report.added.length, 1);
  assert.deepEqual({ stored, regenerated }, before);
});

test('reconciliation rejects referenced removals and unknown references but permits unreferenced removals', () => {
  const valorant = { ...event(), key: 'valorant-1' };
  const dota = {
    ...event({
      game: 'Dota 2',
      gameWiki: 'dota2',
      event: 'Dota 2 at Esports World Cup 2026',
      eventUrl: 'https://liquipedia.net/dota2/Esports_World_Cup/2026',
    }),
    key: 'dota-2',
  };
  const regenerated = [{ ...valorant, key: stableEwcGameKey(valorant), eventIdentity: canonicalEwcEventIdentity(valorant) }];

  const safe = reconcileEwcPredictionGames([valorant, dota], regenerated);
  assert.equal(safe.ok, true);
  assert.deepEqual(safe.removedUnreferenced.map((entry) => entry.oldKey), ['dota-2']);

  const referenced = reconcileEwcPredictionGames([valorant, dota], regenerated, { referencedKeys: ['dota-2'] });
  assert.equal(referenced.ok, false);
  assert.deepEqual(referenced.removedReferenced.map((entry) => entry.oldKey), ['dota-2']);

  const unknown = reconcileEwcPredictionGames([valorant], regenerated, { referencedKeys: ['missing-key'] });
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.unknownReferences, [{ key: 'missing-key' }]);
});

test('week regeneration atomically rekeys games, picks, results, and reminders and is idempotent', async () => {
  const guildId = 'guild-game-key-success';
  const oldValorant = { ...event(), key: 'valorant-2', lockAt: JULY_7 };
  const oldDota = {
    ...event({
      game: 'Dota 2',
      gameWiki: 'dota2',
      event: 'Dota 2 at Esports World Cup 2026',
      eventUrl: 'https://liquipedia.net/dota2/Esports_World_Cup/2026',
    }),
    key: 'dota-1',
    lockAt: JULY_7,
  };
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-keys',
    label: 'Week keys',
    games: [oldDota, oldValorant],
    createdBy: 'test',
  });
  await upsertWeeklyGamePick({
    guildId,
    weekId: week.id,
    userId: '200000000000000001',
    gameKey: oldValorant.key,
    game: oldValorant.game,
    event: oldValorant.event,
    pick: 'Team Falcons',
  });
  await saveWeeklyPredictionScore(guildId, week.id, '200000000000000001', 500, { total: 500 });
  await setEwcWeekResults(week.id, [{ gameKey: oldDota.key, placements: [{ club: 'T1', rank: 1 }] }]);
  const claim = await claimEwcPredictionReminder({
    guildId,
    weekId: week.id,
    gameKey: oldValorant.key,
    kind: 'pre_lock',
    nowSec: 1_000,
  });
  await releaseEwcPredictionReminderClaim({
    guildId,
    weekId: week.id,
    gameKey: oldValorant.key,
    kind: 'pre_lock',
    claimToken: claim,
  });

  const regenerated = [oldValorant, oldDota].map((game) => ({
    ...game,
    key: stableEwcGameKey(game),
    eventIdentity: canonicalEwcEventIdentity(game),
  }));
  const saved = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-keys',
    label: 'Week keys updated',
    games: regenerated,
    createdBy: 'test',
  });

  assert.equal(saved.reconciliation.rekeyed, 2);
  assert.deepEqual(saved.games.map((game) => game.key), regenerated.map((game) => game.key));
  const prediction = await getWeeklyPrediction(guildId, week.id, '200000000000000001');
  assert.equal(prediction.picks[0].gameKey, stableEwcGameKey(oldValorant));
  assert.equal(prediction.score, 500);
  assert.deepEqual(prediction.details, { total: 500 });
  assert.equal(saved.results[0].gameKey, stableEwcGameKey(oldDota));
  assert.equal(
    await getEwcPredictionReminder({ guildId, weekId: week.id, gameKey: oldValorant.key, kind: 'pre_lock' }),
    null,
  );
  const reminder = await getEwcPredictionReminder({
    guildId,
    weekId: week.id,
    gameKey: stableEwcGameKey(oldValorant),
    kind: 'pre_lock',
  });
  assert.equal(reminder.attempts, 1);

  const repeated = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-keys',
    label: 'Week keys updated',
    games: regenerated,
    createdBy: 'test',
  });
  assert.equal(repeated.reconciliation.rekeyed, 0);
  assert.equal(repeated.reconciliation.unchanged, 2);
});

test('referenced removal rolls back games and picks without partial writes', async () => {
  const guildId = 'guild-game-key-rollback';
  const valorant = { ...event(), key: 'valorant-old', lockAt: JULY_7 };
  const dota = {
    ...event({
      game: 'Dota 2',
      gameWiki: 'dota2',
      event: 'Dota 2 at Esports World Cup 2026',
      eventUrl: 'https://liquipedia.net/dota2/Esports_World_Cup/2026',
    }),
    key: 'dota-old',
    lockAt: JULY_7,
  };
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-removal',
    label: 'Week removal',
    games: [valorant, dota],
    createdBy: 'test',
  });
  await upsertWeeklyGamePick({
    guildId,
    weekId: week.id,
    userId: '200000000000000002',
    gameKey: dota.key,
    pick: 'T1',
  });
  const onlyValorant = [{
    ...valorant,
    key: stableEwcGameKey(valorant),
    eventIdentity: canonicalEwcEventIdentity(valorant),
  }];

  await assert.rejects(
    upsertEwcWeek({
      guildId,
      season: '2026',
      weekKey: 'week-removal',
      label: 'Should roll back',
      games: onlyValorant,
      createdBy: 'test',
    }),
    /referenced removal/,
  );

  const saved = await getEwcWeek(guildId, '2026', 'week-removal');
  assert.equal(saved.label, 'Week removal');
  assert.deepEqual(saved.games.map((game) => game.key), ['valorant-old', 'dota-old']);
  const prediction = await getWeeklyPrediction(guildId, week.id, '200000000000000002');
  assert.equal(prediction.picks[0].gameKey, 'dota-old');
});

test('scored weeks refuse key changes but accept an already stable no-op', async () => {
  const guildId = 'guild-game-key-scored';
  const valorant = {
    ...event(),
    key: stableEwcGameKey(event()),
    eventIdentity: canonicalEwcEventIdentity(event()),
    lockAt: JULY_7,
  };
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-scored',
    label: 'Week scored',
    games: [valorant],
    createdBy: 'test',
  });
  await markEwcWeekScoredWithResults(week.id, [{ club: 'Team Falcons', rank: 1 }], [], null);
  await assert.doesNotReject(
    upsertEwcWeek({
      guildId,
      season: '2026',
      weekKey: 'week-scored',
      label: 'Week scored',
      games: [valorant],
      createdBy: 'test',
    }),
  );

  const chess = {
    game: 'Chess',
    gameWiki: 'chess',
    event: 'Chess at Esports World Cup 2026',
    eventUrl: 'https://liquipedia.net/chess/Esports_World_Cup/2026',
    key: stableEwcGameKey({ game: 'Chess', eventUrl: 'https://liquipedia.net/chess/Esports_World_Cup/2026' }),
    eventIdentity: canonicalEwcEventIdentity({ game: 'Chess', eventUrl: 'https://liquipedia.net/chess/Esports_World_Cup/2026' }),
  };
  await assert.rejects(
    upsertEwcWeek({
      guildId,
      season: '2026',
      weekKey: 'week-scored',
      label: 'Week scored',
      games: [valorant, chess],
      createdBy: 'test',
    }),
    /Scored EWC prediction weeks cannot change/,
  );
});
