import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'club-championship-job-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { getEwcClubChampionshipSnapshot, upsertEwcClubChampionshipSnapshot } = await import(
  '../src/db/ewcClubChampionshipSnapshots.js'
);
const { setClubChampionship } = await import('../src/db/settings.js');
const { updateClubChampionship } = await import('../src/jobs/clubChampionship.js');

function payload(team, points) {
  return {
    sourceUrl: 'https://liquipedia.net/esports/Esports_World_Cup/2026/Club_Championship_Standings',
    standings: [{ rank: 1, team, points, eligibility: 'champion' }],
    prizepool: [{ place: '1st', prize: '$1,000,000', teams: [team] }],
  };
}

async function configure(guildId) {
  await setClubChampionship(guildId, {
    wiki: 'esports',
    page: 'Esports_World_Cup/2026/Club_Championship_Standings',
    channelId: `channel-${guildId}`,
    label: 'EWC Club Championship',
  });
}

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('a successful fetch is saved before a Discord send failure', async () => {
  const guildId = 'guild-send-failure';
  await configure(guildId);
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        messages: { fetch: async () => null },
        send: async () => {
          throw new Error('Missing Permissions');
        },
      }),
    },
  };

  await assert.rejects(
    updateClubChampionship(client, guildId, {
      liquipedia: { fetchClubChampionship: async () => payload('Saved Club', 150) },
    }),
    /Missing Permissions/,
  );
  assert.equal((await getEwcClubChampionshipSnapshot('2026')).standings[0].team, 'Saved Club');
});

test('a failed fetch leaves the prior snapshot untouched and skips Discord', async () => {
  const guildId = 'guild-fetch-failure';
  await configure(guildId);
  await upsertEwcClubChampionshipSnapshot({
    season: '2026',
    ...payload('Last Good Club', 140),
    fetchedAt: '2026-07-10T10:00:00.000Z',
  });
  let channelFetches = 0;
  const client = { channels: { fetch: async () => { channelFetches += 1; return null; } } };

  const updated = await updateClubChampionship(client, guildId, {
    liquipedia: { fetchClubChampionship: async () => { throw new Error('temporary parse failure'); } },
  });
  assert.equal(updated, false);
  assert.equal(channelFetches, 0);
  assert.equal((await getEwcClubChampionshipSnapshot('2026')).standings[0].team, 'Last Good Club');
});

test('an empty parse cannot overwrite or post over the last good data', async () => {
  const guildId = 'guild-empty-parse';
  await configure(guildId);
  let channelFetches = 0;
  const client = { channels: { fetch: async () => { channelFetches += 1; return null; } } };

  const updated = await updateClubChampionship(client, guildId, {
    liquipedia: { fetchClubChampionship: async () => ({ ...payload('Empty', 0), standings: [] }) },
  });
  assert.equal(updated, false);
  assert.equal(channelFetches, 0);
  assert.equal((await getEwcClubChampionshipSnapshot('2026')).standings[0].team, 'Last Good Club');
});
