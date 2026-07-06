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
const { data } = await import('../src/commands/ewc_predict.js');

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
