import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-profile-auto-sync-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.EWC_DASHBOARD_INTERNAL_URL = 'http://dashboard.internal';
process.env.EWC_DASHBOARD_INTERNAL_SECRET = 'test-internal-secret';

const { closeDb } = await import('../src/db/index.js');
const { upsertEwcProfileLink } = await import('../src/db/ewcProfileLinks.js');
const { refreshLinkedProfileAfterFirstWeeklyPick } = await import('../src/commands/ewc_predict.js');
const { runEwcPredictionAutomation } = await import('../src/jobs/ewcPredictions.js');

const discordUserId = '200000000000000001';
const guildId = '900000000000000001';
const season = '2026';
const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('refreshes linked role metadata on startup and the first pick of a new week', async () => {
  await upsertEwcProfileLink({
    authUserId: 'auth-user-1',
    discordUserId,
    guildId,
    season,
  });

  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await runEwcPredictionAutomation();
  await runEwcPredictionAutomation();
  assert.equal(requests.length, 1, 'startup reconciliation runs once per process');

  await refreshLinkedProfileAfterFirstWeeklyPick({
    firstPick: false,
    discordUserId,
    guildId,
    season,
  });
  assert.equal(requests.length, 1, 'editing an existing weekly row does not resync the activity count');

  await refreshLinkedProfileAfterFirstWeeklyPick({
    firstPick: true,
    discordUserId,
    guildId,
    season,
  });
  assert.equal(requests.length, 2);

  const request = requests[1];
  assert.equal(request.url, 'http://dashboard.internal/api/internal/ewc-profile/sync');
  assert.equal(request.options.headers['x-ewc-internal-secret'], 'test-internal-secret');
  assert.deepEqual(JSON.parse(request.options.body), { discordUserId, guildId, season });
});
