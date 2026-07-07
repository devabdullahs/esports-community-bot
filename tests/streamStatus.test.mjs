import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'stream-status-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { createStreamChannel } = await import('../src/db/streamChannels.js');
const {
  upsertStreamStatus,
  getStreamStatus,
  getStreamStatuses,
  listLiveStreamStatuses,
  markStaleStatusesOffline,
} = await import('../src/db/streamChannelStatus.js');
const { refreshStreamStatus } = await import('../src/jobs/streamStatus.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('upsertStreamStatus stores a live snapshot, then clears it when offline', async () => {
  await upsertStreamStatus({
    platform: 'twitch',
    handle: 'live1',
    isLive: true,
    title: 'Ranked',
    viewerCount: 42,
    category: 'Overwatch 2',
    startedAt: 1_700_000_000,
  });
  let s = await getStreamStatus('twitch', 'live1');
  assert.equal(s.isLive, true);
  assert.equal(s.viewerCount, 42);
  assert.equal(s.title, 'Ranked');
  assert.ok(s.checkedAt > 0);

  await upsertStreamStatus({ platform: 'twitch', handle: 'live1', isLive: false, title: 'stale', viewerCount: 99 });
  s = await getStreamStatus('twitch', 'live1');
  assert.equal(s.isLive, false);
  assert.equal(s.title, null, 'offline clears the live snapshot');
  assert.equal(s.viewerCount, null);
});

test('getStreamStatuses keys results by platform:handle', async () => {
  await upsertStreamStatus({ platform: 'kick', handle: 'kk', isLive: true });
  const map = await getStreamStatuses([
    { platform: 'twitch', handle: 'live1' },
    { platform: 'kick', handle: 'kk' },
    { platform: 'twitch', handle: 'missing' },
  ]);
  assert.equal(map.get('kick:kk').isLive, true);
  assert.equal(map.get('twitch:live1').isLive, false);
  assert.equal(map.has('twitch:missing'), false);
});

test('markStaleStatusesOffline forces not-recently-checked live rows offline', async () => {
  await upsertStreamStatus({ platform: 'twitch', handle: 'goes-stale', isLive: true, viewerCount: 5 });
  // A negative max-age makes the cutoff just in the future, so the row we just wrote counts as stale.
  const changed = await markStaleStatusesOffline(-5);
  assert.ok(changed >= 1);
  assert.equal((await getStreamStatus('twitch', 'goes-stale')).isLive, false);
});

test('refreshStreamStatus polls the injected services and writes per-channel status', async () => {
  await createStreamChannel({ platform: 'twitch', handle: 'twlive', scope: 'ewc' });
  await createStreamChannel({ platform: 'twitch', handle: 'twoff', scope: 'game', gameSlug: 'overwatch' });
  await createStreamChannel({ platform: 'kick', handle: 'kklive', scope: 'ewc' });

  const twitchSvc = {
    isConfigured: () => true,
    getLiveStreams: async (handles) => {
      assert.ok(handles.includes('twlive') && handles.includes('twoff'));
      return new Map([['twlive', { isLive: true, viewerCount: 10, title: 'live now' }]]);
    },
  };
  const kickSvc = {
    isConfigured: () => true,
    getLiveChannels: async () => new Map([['kklive', { isLive: true, viewerCount: 7 }]]),
  };

  const summary = await refreshStreamStatus({ twitchSvc, kickSvc });
  assert.deepEqual(summary, ['twitch 1/2', 'kick 1/1']);

  assert.equal((await getStreamStatus('twitch', 'twlive')).isLive, true);
  assert.equal((await getStreamStatus('twitch', 'twoff')).isLive, false, 'absent from live map -> offline');
  assert.equal((await getStreamStatus('kick', 'kklive')).isLive, true);

  const live = await listLiveStreamStatuses();
  const liveKeys = new Set(live.map((s) => `${s.platform}:${s.handle}`));
  assert.ok(liveKeys.has('twitch:twlive') && liveKeys.has('kick:kklive'));
  assert.ok(!liveKeys.has('twitch:twoff'));
});

test('youtube polls on its own cadence, keeps previous status on fetch gaps, stores video id', async () => {
  await createStreamChannel({ platform: 'youtube', handle: 'ytlive', scope: 'ewc' });

  const noopSvc = { isConfigured: () => false };
  let ytCalls = 0;
  const youtubeSvc = {
    isConfigured: () => true,
    getLiveChannels: async () => {
      ytCalls += 1;
      // First refresh: live with a video id. Later refreshes: fetch failed -> empty map.
      return ytCalls === 1
        ? new Map([['ytlive', { isLive: true, title: 'YT live', viewerCount: 42, videoId: 'vid123abc' }]])
        : new Map();
    },
  };

  let clock = 1_000_000_000;
  const now = () => clock;
  const opts = { twitchSvc: noopSvc, kickSvc: noopSvc, youtubeSvc, now };

  const first = await refreshStreamStatus(opts);
  assert.deepEqual(first, ['youtube 1/1']);
  const status = await getStreamStatus('youtube', 'ytlive');
  assert.equal(status.isLive, true);
  assert.equal(status.videoId, 'vid123abc');

  // Within the youtube cadence window: the platform is skipped entirely.
  clock += 30_000;
  await refreshStreamStatus(opts);
  assert.equal(ytCalls, 1, 'second tick inside the cadence window skips youtube');

  // Past the cadence window: polled again, but the empty map (fetch failure)
  // must keep the previous LIVE status instead of flapping it offline.
  clock += 400_000;
  await refreshStreamStatus(opts);
  assert.equal(ytCalls, 2);
  assert.equal((await getStreamStatus('youtube', 'ytlive')).isLive, true, 'fetch gap keeps previous status');
});
