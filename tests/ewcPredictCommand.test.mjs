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
const { buildProfileDetailsComponents, buildScoreBreakdownEmbed, data, handleComponent } = await import('../src/commands/ewc_predict.js');

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
