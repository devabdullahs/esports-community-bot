import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.LOG_LEVEL = 'error';
const { createStreamChannel } = await import('../src/db/streamChannels.js');
const { setCostreamAnnounceChannel } = await import('../src/db/settings.js');
const { upsertStreamStatus } = await import('../src/db/streamChannelStatus.js');
const { claimStreamCreatorAnnouncement } = await import('../src/db/streamAnnouncements.js');
const { refreshStreamStatus, resetStreamStatusStateForTests } = await import('../src/jobs/streamStatus.js');
const noop = { isConfigured: () => false };

test('150 overlapping polls produce one fetch and one go-live message', async () => {
  await createStreamChannel({ platform: 'twitch', handle: 'burst', scope: 'ewc' });
  await setCostreamAnnounceChannel('burst-guild', 'announce');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let fetches = 0;
  const messages = [];
  const options = {
    twitchSvc: { isConfigured: () => true, getLiveStreams: async () => {
      fetches++;
      await gate;
      return new Map([['burst', { isLive: true, startedAt: 1000 }]]);
    } },
    kickSvc: noop, youtubeSvc: noop,
    client: { channels: { fetch: async () => ({ isTextBased: () => true, send: async payload => { messages.push(payload); } }) } },
  };
  const requests = Array.from({ length: 150 }, () => refreshStreamStatus(options));
  assert.ok(requests.every(promise => promise === requests[0]));
  release();
  await Promise.all(requests);
  assert.equal(fetches, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].enforceNonce, true);
  assert.match(messages[0].nonce, /^[a-f0-9]{24}$/);
});

test('the database grants only one of 150 concurrent announcement claims', async () => {
  const claims = await Promise.all(Array.from({ length: 150 }, () => claimStreamCreatorAnnouncement({
    creatorKey: 'atomic', platform: 'twitch', handle: 'atomic', announcedAt: 10000, liveStartedAt: 9000,
  })));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await claimStreamCreatorAnnouncement({ creatorKey: 'atomic', platform: 'twitch', handle: 'atomic', announcedAt: 20000, liveStartedAt: 9000 }), false, 'same broadcast stays suppressed past cooldown');
  assert.equal(await claimStreamCreatorAnnouncement({ creatorKey: 'atomic', platform: 'twitch', handle: 'atomic', announcedAt: 20000, liveStartedAt: 19000 }), true, 'a new broadcast can announce');
});

test('YouTube video identity survives elapsed cooldown and changed titles', async () => {
  const claim = { creatorKey: 'youtube:session', platform: 'youtube', handle: 'session', liveVideoId: 'video123', announcedAt: 10000 };
  assert.equal(await claimStreamCreatorAnnouncement(claim), true);
  assert.equal(await claimStreamCreatorAnnouncement({ ...claim, announcedAt: 100000, title: 'Changed title' }), false);
  assert.equal(await claimStreamCreatorAnnouncement({ ...claim, announcedAt: 100000, liveVideoId: 'newVideo' }), true);
});

test('a send timeout followed by restart and status flap does not repeat the ping', async () => {
  await createStreamChannel({ platform: 'twitch', handle: 'ambiguous', scope: 'ewc' });
  let clock = Date.now();
  let sends = 0;
  const options = {
    now: () => clock,
    twitchSvc: { isConfigured: () => true, getLiveStreams: async () => new Map([['ambiguous', { isLive: true, startedAt: 5000 }]]) },
    kickSvc: noop, youtubeSvc: noop,
    client: { channels: { fetch: async () => ({ isTextBased: () => true, send: async () => {
      sends++;
      throw new Error('Response lost after Discord accepted the message');
    } }) } },
  };
  await refreshStreamStatus(options);
  assert.equal(sends, 1);
  resetStreamStatusStateForTests();
  await upsertStreamStatus({ platform: 'twitch', handle: 'ambiguous', isLive: false });
  clock += 3600000;
  await refreshStreamStatus(options);
  assert.equal(sends, 1);
});

test('a rejected poll releases the in-flight guard for the next check', async () => {
  await assert.rejects(refreshStreamStatus({ twitchSvc: null }), TypeError);
  await assert.doesNotReject(refreshStreamStatus({ twitchSvc: noop, kickSvc: noop, youtubeSvc: noop, client: null }));
});
