import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

const PROFILE_SECRET = 'p'.repeat(64);
const NEWS_SECRET = 'n'.repeat(64);
const originalEnv = {
  url: process.env.EWC_DASHBOARD_INTERNAL_URL,
  profile: process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET,
  news: process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET,
  legacy: process.env.EWC_DASHBOARD_INTERNAL_SECRET,
};

let mode = 'success';
let requests = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    requests.push({
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });

    if (mode === 'redirect') {
      response.writeHead(302, { Location: 'http://example.com/not-allowed' });
      response.end();
      return;
    }
    if (mode === 'timeout') {
      setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
      }, 5_500);
      return;
    }
    if (mode === 'oversized') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ payload: 'x'.repeat(40 * 1024) }));
      return;
    }
    if (mode === 'invalid-json') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{broken');
      return;
    }
    if (mode === 'upstream-error') {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('sensitive upstream diagnostic');
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

function configure({
  url = baseUrl,
  profile = PROFILE_SECRET,
  news = NEWS_SECRET,
  legacy,
} = {}) {
  process.env.EWC_DASHBOARD_INTERNAL_URL = url;
  process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET = profile;
  process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET = news;
  if (legacy === undefined) delete process.env.EWC_DASHBOARD_INTERNAL_SECRET;
  else process.env.EWC_DASHBOARD_INTERNAL_SECRET = legacy;
}

async function loadClient(label) {
  return import(`../src/services/dashboardInternalClient.js?test=${encodeURIComponent(label)}-${Date.now()}-${Math.random()}`);
}

test.after(() => {
  server.closeAllConnections();
  server.close();
  for (const [key, value] of Object.entries(originalEnv)) {
    const envName = {
      url: 'EWC_DASHBOARD_INTERNAL_URL',
      profile: 'EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET',
      news: 'EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET',
      legacy: 'EWC_DASHBOARD_INTERNAL_SECRET',
    }[key];
    if (value === undefined) delete process.env[envName];
    else process.env[envName] = value;
  }
});

test('exports only the two named, fixed-capability operations', async () => {
  configure();
  const client = await loadClient('exports');
  assert.deepEqual(Object.keys(client).sort(), ['revalidateDashboardNews', 'syncDashboardProfile']);
});

test('pins profile sync and news revalidation to fixed loopback routes and credentials', async () => {
  configure();
  mode = 'success';
  requests = [];
  const client = await loadClient('success');

  await client.syncDashboardProfile({
    discordUserId: '200000000000000001',
    guildId: '900000000000000001',
    season: '2026',
    path: '/../not-used',
    url: 'https://example.com',
  });
  await client.revalidateDashboardNews();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/api/internal/ewc-profile/sync');
  assert.equal(requests[0].headers['x-ewc-internal-secret'], PROFILE_SECRET);
  assert.deepEqual(JSON.parse(requests[0].body), {
    discordUserId: '200000000000000001',
    guildId: '900000000000000001',
    season: '2026',
  });
  assert.equal(requests[1].url, '/api/internal/news/revalidate');
  assert.equal(requests[1].headers['x-ewc-internal-secret'], NEWS_SECRET);
  assert.equal(requests[1].body, '');
});

test('rejects unsafe or ambiguous internal base URLs at module startup', async () => {
  const invalidUrls = [
    'https://127.0.0.1:3000',
    'http://example.com:3000',
    'http://10.0.0.1:3000',
    'http://localhost',
    'http://user:pass@localhost:3000',
    'http://localhost:3000/path',
    'http://localhost:3000/../',
    'http://localhost:3000/%2e%2e/',
    'http://localhost:3000/?next=/api/internal',
    'http://localhost:3000/#fragment',
    'http://localhost:3000\\api',
  ];

  for (const [index, url] of invalidUrls.entries()) {
    configure({ url });
    await assert.rejects(loadClient(`invalid-${index}`), /misconfigured/);
  }
});

test('refuses redirects without following them', async () => {
  configure();
  mode = 'redirect';
  requests = [];
  const client = await loadClient('redirect');
  await assert.rejects(client.revalidateDashboardNews(), /could not be reached/);
  assert.equal(requests.length, 1);
});

test('enforces a bounded timeout', async () => {
  configure();
  mode = 'timeout';
  requests = [];
  const client = await loadClient('timeout');
  await assert.rejects(client.revalidateDashboardNews(), /timed out/);
  assert.equal(requests.length, 1);
});

test('rejects oversized and invalid JSON responses', async () => {
  configure();
  const client = await loadClient('response-validation');

  mode = 'oversized';
  await assert.rejects(client.revalidateDashboardNews(), /exceeded the allowed size/);

  mode = 'invalid-json';
  await assert.rejects(client.revalidateDashboardNews(), /invalid response/);
});

test('does not surface an upstream response body in errors', async () => {
  configure();
  mode = 'upstream-error';
  const client = await loadClient('sanitized-error');
  await assert.rejects(
    client.revalidateDashboardNews(),
    (error) => error instanceof Error
      && /status 500/.test(error.message)
      && !error.message.includes('sensitive upstream diagnostic'),
  );
});

test('does not accept the removed shared secret as a fallback', async () => {
  configure({
    profile: '',
    news: '',
    legacy: 'l'.repeat(64),
  });
  await assert.rejects(loadClient('legacy-only'), /misconfigured/);
});

test('rejects secrets with surrounding whitespace or control characters', async () => {
  configure({
    profile: ` ${PROFILE_SECRET}`,
    news: `${NEWS_SECRET}\n`,
  });
  await assert.rejects(loadClient('ambiguous-secrets'), /misconfigured/);
});
