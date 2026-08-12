import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { runSmokeCheck, resolveBaseUrl } from '../scripts/smoke-public.mjs';

// The MCP half of the public smoke check broke silently for a day when the
// handshake era started answering over SSE: the probe asserted
// `application/json`, the workflow only runs on a nightly schedule, and CI never
// exercises it. These tests pin the shape it accepts so that cannot repeat.

const MODERN_TOOLS = {
  tools: [{ name: 'list_games' }],
  resultType: 'complete',
  ttlMs: 300_000,
  cacheScope: 'public',
};

const DISCOVER = {
  supportedVersions: ['2026-07-28'],
  capabilities: { tools: {} },
  resultType: 'complete',
};

function page(locale) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head></head><body>ok</body></html>`;
}

// Answers every target the check probes. `overrides` replaces the JSON-RPC
// result for one MCP method so a single assertion can be driven to fail.
function startServer({ overrides = {}, legacyOverSse = true } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        const modern = Boolean(body.params?._meta?.['io.modelcontextprotocol/protocolVersion']);
        const key = modern ? `modern:${body.method}` : `legacy:${body.method}`;
        const fallback = body.method === 'server/discover'
          ? DISCOVER
          : modern
            ? MODERN_TOOLS
            : { tools: [{ name: 'list_games' }] };
        const result = key in overrides ? overrides[key] : fallback;
        const payload = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });

        if (!modern && legacyOverSse) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`event: message\ndata: ${payload}\n\n`);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(payload);
      });
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\n');
      return;
    }
    if (url.pathname === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<urlset></urlset>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(url.pathname.startsWith('/ar') ? 'ar' : 'en'));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: resolveBaseUrl(`http://127.0.0.1:${port}`) });
    });
  });
}

async function withServer(options, run) {
  const { server, baseUrl } = await startServer(options);
  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function silenced(run) {
  const original = console.log;
  console.log = () => {};
  return run().finally(() => { console.log = original; });
}

test('accepts a handshake-era answer delivered over SSE', async () => {
  await withServer({ legacyOverSse: true }, (baseUrl) =>
    silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })));
});

test('accepts a handshake-era answer delivered as JSON', async () => {
  // The transport may return either; neither form should fail the check.
  await withServer({ legacyOverSse: false }, (baseUrl) =>
    silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })));
});

test('fails when the modern tool list loses its cache hints', async () => {
  await withServer(
    { overrides: { 'modern:tools/list': { tools: [{ name: 'list_games' }], resultType: 'complete' } } },
    async (baseUrl) => {
      await assert.rejects(
        silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })),
        /unusable cache hints/,
      );
    },
  );
});

test('fails when the public tool list is marked private', async () => {
  await withServer(
    { overrides: { 'modern:tools/list': { ...MODERN_TOOLS, cacheScope: 'private' } } },
    async (baseUrl) => {
      await assert.rejects(
        silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })),
        /unusable cache hints/,
      );
    },
  );
});

test('fails when a result drops resultType', async () => {
  await withServer(
    { overrides: { 'modern:tools/list': { tools: [{ name: 'list_games' }], ttlMs: 1, cacheScope: 'public' } } },
    async (baseUrl) => {
      await assert.rejects(
        silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })),
        /resultType/,
      );
    },
  );
});

test('fails when discovery stops advertising the modern revision', async () => {
  await withServer(
    { overrides: { 'modern:server/discover': { supportedVersions: ['2025-11-25'], capabilities: { tools: {} } } } },
    async (baseUrl) => {
      await assert.rejects(
        silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })),
        /does not advertise 2026-07-28/,
      );
    },
  );
});

test('fails when 2026 fields leak into a handshake-era answer', async () => {
  await withServer(
    { overrides: { 'legacy:tools/list': { tools: [{ name: 'list_games' }], resultType: 'complete' } } },
    async (baseUrl) => {
      await assert.rejects(
        silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })),
        /leaked 2026-07-28 fields/,
      );
    },
  );
});

test('fails when either era serves no tools', async () => {
  await withServer(
    { overrides: { 'legacy:tools/list': { tools: [] } } },
    async (baseUrl) => {
      await assert.rejects(
        silenced(() => runSmokeCheck({ baseUrl, timeoutMs: 5_000 })),
        /did not return any tools/,
      );
    },
  );
});
