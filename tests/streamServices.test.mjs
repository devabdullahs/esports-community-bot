import assert from 'node:assert/strict';
import test from 'node:test';

// config exits on missing required vars; set everything before importing services.
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.TWITCH_CLIENT_ID = 'tw-id';
process.env.TWITCH_CLIENT_SECRET = 'tw-secret';
process.env.KICK_CLIENT_ID = 'kk-id';
process.env.KICK_CLIENT_SECRET = 'kk-secret';
process.env.LOG_LEVEL = 'error';

const twitch = await import('../src/services/twitch.js');
const kick = await import('../src/services/kick.js');
const youtube = await import('../src/services/youtube.js');

// A fake axios-like client. `get` reads the handle list from the query string and
// returns only the configured channels — no network.
function makeClient({ live = [], tokenName = 'tok', failGetOnce = false }) {
  const calls = { post: 0, get: 0 };
  let failed = false;
  return {
    calls,
    async post() {
      calls.post += 1;
      return { data: { access_token: `${tokenName}${calls.post}`, expires_in: 3600 } };
    },
    async get(url) {
      calls.get += 1;
      if (failGetOnce && !failed) {
        failed = true;
        const err = new Error('unauthorized');
        err.response = { status: 401 };
        throw err;
      }
      const params = new URL(url).searchParams;
      const wanted = new Set([...params.getAll('user_login'), ...params.getAll('slug')]);
      return { data: { data: live.filter((row) => wanted.has(row.user_login || row.slug)) } };
    },
  };
}

test('twitch.getAppToken caches the token across calls', async () => {
  twitch.resetTokenCache();
  const client = makeClient({});
  const a = await twitch.getAppToken({ client });
  const b = await twitch.getAppToken({ client });
  assert.equal(a, b);
  assert.equal(client.calls.post, 1, 'token fetched once, then cached');
});

test('twitch.getLiveStreams returns only live channels, keyed lowercased', async () => {
  twitch.resetTokenCache();
  const client = makeClient({
    live: [
      {
        user_login: 'owbrain',
        type: 'live',
        title: 'OW ranked',
        viewer_count: 1234,
        game_name: 'Overwatch 2',
        started_at: '2026-06-20T10:00:00Z',
      },
    ],
  });
  // The registry stores Twitch handles lowercased, so the poller passes lowercased logins.
  const map = await twitch.getLiveStreams(['owbrain', 'offlineguy'], { client });
  assert.equal(map.size, 1, 'offline channels are absent');
  const ow = map.get('owbrain');
  assert.equal(ow.isLive, true);
  assert.equal(ow.viewerCount, 1234);
  assert.equal(ow.category, 'Overwatch 2');
  assert.ok(ow.startedAt > 0);
  assert.equal(map.has('offlineguy'), false);
});

test('twitch.getLiveStreams batches logins by 100', async () => {
  twitch.resetTokenCache();
  const client = makeClient({});
  const logins = Array.from({ length: 150 }, (_, i) => `u${i}`);
  await twitch.getLiveStreams(logins, { client });
  assert.equal(client.calls.get, 2, '150 logins -> two batched calls');
});

test('twitch.getLiveStreams refreshes the token and retries on a 401', async () => {
  twitch.resetTokenCache();
  const client = makeClient({ live: [{ user_login: 'a', type: 'live' }], failGetOnce: true });
  const map = await twitch.getLiveStreams(['a'], { client });
  assert.equal(client.calls.post, 2, 'token refreshed after the 401');
  assert.equal(map.get('a').isLive, true);
});

test('kick.getLiveChannels returns both live and offline channels with is_live', async () => {
  kick.resetTokenCache();
  const client = makeClient({
    live: [
      { slug: 'someone', stream: { is_live: true, stream_title: 'hi', viewer_count: 50, start_time: '2026-06-20T10:00:00Z' } },
      { slug: 'offkick', stream: { is_live: false } },
    ],
  });
  const map = await kick.getLiveChannels(['someone', 'offkick'], { client });
  assert.equal(map.get('someone').isLive, true);
  assert.equal(map.get('someone').viewerCount, 50);
  assert.equal(map.get('offkick').isLive, false);
});

test('kick.getLiveChannels batches slugs by 50', async () => {
  kick.resetTokenCache();
  const client = makeClient({});
  const slugs = Array.from({ length: 120 }, (_, i) => `s${i}`);
  await kick.getLiveChannels(slugs, { client });
  assert.equal(client.calls.get, 3, '120 slugs -> three batched calls');
});

// ---------------------------------------------------------------------------
// youtube (credential-free /live page probe)
// ---------------------------------------------------------------------------

const LIVE_PAGE = `
<html><head>
<link rel="canonical" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
<meta name="title" content="EWC Finals Watch Party &amp; More">
</head><body>
<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"dQw4w9WgXcQ","isLiveContent":true},"microformat":{"liveBroadcastDetails":{"isLiveNow":true}}};</script>
<span>12,345 watching now</span>
</body></html>`;

const UPCOMING_PAGE = `
<html><head>
<link rel="canonical" href="https://www.youtube.com/watch?v=abc123def45">
<meta name="title" content="Starting soon">
</head><body>
<script>{"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-08-01T00:00:00+00:00"}}</script>
</body></html>`;

const OFFLINE_PAGE = '<html><head><link rel="canonical" href="https://www.youtube.com/@someone/streams"></head><body></body></html>';

test('youtube.parseLivePage detects a current broadcast with video id, title, viewers', () => {
  const parsed = youtube.parseLivePage(LIVE_PAGE);
  assert.equal(parsed.isLive, true);
  assert.equal(parsed.videoId, 'dQw4w9WgXcQ');
  assert.equal(parsed.title, 'EWC Finals Watch Party & More'); // entity decoded
  assert.equal(parsed.viewerCount, 12345);
  assert.match(parsed.thumbnailUrl, /dQw4w9WgXcQ/);
});

test('youtube.parseLivePage treats upcoming/offline pages as not live', () => {
  assert.equal(youtube.parseLivePage(UPCOMING_PAGE).isLive, false, 'scheduled stream is not live');
  assert.equal(youtube.parseLivePage(OFFLINE_PAGE).isLive, false, 'no broadcast is not live');
});

test('youtube.getLiveChannels maps handles and OMITS handles whose fetch failed', async () => {
  const client = {
    async get(url) {
      if (url.includes('gooddude')) return { status: 200, data: LIVE_PAGE };
      if (url.includes('offdude')) return { status: 200, data: OFFLINE_PAGE };
      throw new Error('network down');
    },
  };
  const map = await youtube.getLiveChannels(['gooddude', 'offdude', 'brokendude'], { client, gapMs: 0 });
  assert.equal(map.get('gooddude').isLive, true);
  assert.equal(map.get('gooddude').videoId, 'dQw4w9WgXcQ');
  assert.equal(map.get('offdude').isLive, false);
  assert.equal(map.has('brokendude'), false, 'failed fetch reports nothing (keep previous status)');
});
