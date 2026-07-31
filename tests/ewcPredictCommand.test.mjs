import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-predict-command-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const {
  buildProfileDetailsComponents,
  buildScoreBreakdownEmbed,
  buildWeekPicksEmbed,
  data,
  handleComponent,
} = await import('../src/commands/ewc_predict.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('ewc_predict does not expose a season option to members', () => {
  const command = data.toJSON();
  const subcommands = command.options || [];
  assert.ok(subcommands.some((option) => option.name === 'season'), 'keeps the whole-season prediction subcommand');

  const seasonOptions = subcommands.flatMap((subcommand) =>
    (subcommand.options || [])
      .filter((option) => option.name === 'season')
      .map((option) => `${subcommand.name}.${option.name}`),
  );

  assert.deepEqual(seasonOptions, []);
});

test('ewc_predict weekly exposes only the guided week option', () => {
  const command = data.toJSON();
  const weekly = command.options?.find((option) => option.name === 'weekly');
  assert.deepEqual(weekly?.options?.map((option) => option.name), ['week']);
});

test('score details select is owner-bound and Discord-size safe', async () => {
  const components = buildProfileDetailsComponents(
    {
      season: { score: 500 },
      weekly: [{ week_key: 'week-1', label: 'A'.repeat(180), score: 100 }],
    },
    '2026',
    'target-user',
    'opening-user',
  );
  const menu = components[0].toJSON().components[0];
  assert.equal(menu.custom_id, 'ewc_predict:pd:2026:target-user:opening-user');
  assert.ok(menu.options.every((option) => option.label.length <= 100 && option.description.length <= 100));

  const embed = buildScoreBreakdownEmbed('A'.repeat(500), {
    available: true,
    kind: 'weekly-per-game',
    total: 0,
    bonus: 0,
    integrity: 'ok',
    rows: Array.from({ length: 30 }, () => ({ game: 'Game'.repeat(100), pick: 'Pick'.repeat(300), points: 0, status: 'missed' })),
  }).toJSON();
  assert.ok(embed.title.length <= 256);
  assert.equal(embed.fields.length, 20);
  assert.ok(embed.fields.every((field) => field.name.length <= 256 && field.value.length <= 1024));

  const replies = [];
  await handleComponent({
    customId: 'ewc_predict:pd:2026:target-user:opening-user',
    user: { id: 'different-user' },
    reply: async (payload) => replies.push(payload),
  });
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /belong to whoever opened/i);
});

test('profile detail menu offers rounds that only hold saved picks', () => {
  const components = buildProfileDetailsComponents(
    {
      season: { picks: ['Team Falcons', 'T1'] },
      weekly: [
        { week_key: 'week-1', label: 'Week 1', picks: [{ gameKey: 'ff', game: 'Free Fire', pick: 'Team Falcons' }] },
        { week_key: 'week-2', label: 'Week 2', picks: [] },
      ],
    },
    '2026',
    'target-user',
    'target-user',
  );
  const menu = components[0].toJSON().components[0];
  assert.deepEqual(menu.options.map((option) => option.value), ['season', 'week:week-1']);
  assert.ok(menu.options.every((option) => option.description.length <= 100));
});

test('week picks embed shows the owner every pick and hides unlocked picks from others', () => {
  const now = Math.floor(Date.now() / 1000);
  const week = {
    week_key: 'wk',
    label: 'Week 1',
    close_at: now + 7200,
    games: [
      { key: 'ff', game: 'Free Fire', event: 'EWC', lockAt: now - 3600 },
      { key: 'dota', game: 'Dota 2', event: 'EWC', lockAt: now + 3600 },
      { key: 'cs', game: 'Counter-Strike', event: 'EWC', lockAt: now + 3600 },
    ],
    picks: [
      { gameKey: 'ff', game: 'Free Fire', pick: 'Team Falcons' },
      { gameKey: 'dota', game: 'Dota 2', pick: 'Tundra Esports' },
    ],
  };

  const owner = buildWeekPicksEmbed(week, { isOwner: true, now }).toJSON();
  assert.match(owner.description, /Team Falcons/);
  assert.match(owner.description, /Tundra Esports/);
  assert.match(owner.description, /no pick/);

  const other = buildWeekPicksEmbed(week, { isOwner: false, now }).toJSON();
  assert.match(other.description, /Team Falcons/, 'a locked game is public once it locks');
  assert.doesNotMatch(other.description, /Tundra Esports/, 'an unlocked game stays hidden');
  assert.match(other.description, /hidden until lock/);
});
