import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const dir = mkdtempSync(join(tmpdir(), 'web-analytics-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const legacyDb = new Database(process.env.DB_PATH);
legacyDb.exec(`
  CREATE TABLE web_analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    path TEXT NOT NULL,
    referrer TEXT,
    country TEXT,
    user_agent TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    occurred_at INTEGER NOT NULL
  );
`);
const insertLegacy = legacyDb.prepare(`
  INSERT INTO web_analytics_events
    (visitor_id, session_id, event_type, path, referrer, occurred_at)
  VALUES (?, ?, 'pageview', '/legacy', ?, 1)
`);
for (const [id, referrer] of [
  ['x', 'https://x.com'],
  ['x-shortener', 'https://t.co'],
  ['discord', 'https://discord.gg'],
  ['discord-legacy', 'https://cdn.discordapp.com'],
  ['google', 'https://www.google.com'],
  ['google-country', 'https://news.google.co.uk'],
  ['google-lookalike', 'https://google.evil.example'],
  ['bing', 'https://www.bing.com'],
  ['referral', 'https://publisher.example'],
  ['internal', '/news?page=2'],
  ['direct', null],
]) {
  insertLegacy.run(`legacy-${id}`, `legacy-${id}`, referrer);
}
legacyDb.close();

const { closeDb, db } = await import('../src/db/index.js');
const {
  getWebAnalyticsDashboard,
  getWebProductAnalytics,
  recordWebAnalyticsEvent,
  recordWebProductEvent,
} = await import('../src/db/webAnalytics.js');
const { purgeWebAnalyticsRetention } = await import('../src/jobs/webAnalyticsRetention.js');
const { appTables, identityColumns } = await import('../scripts/migrate-sqlite-to-postgres.mjs');
const migratedLegacyRows = db.prepare(`
  SELECT visitor_id, acquisition_source
    FROM web_analytics_events
   WHERE visitor_id LIKE 'legacy-%'
   ORDER BY visitor_id
`).all();
const migratedLegacyColumns = db.prepare('PRAGMA table_info(web_analytics_events)').all();
const migratedLegacyCount = db.prepare("SELECT COUNT(*) AS count FROM web_analytics_events WHERE visitor_id LIKE 'legacy-%'").get().count;
const productTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'web_product_events'").get();
db.prepare("DELETE FROM web_analytics_events WHERE visitor_id LIKE 'legacy-%'").run();

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('summarizes visitors, returning users, engagement, countries, and top pages', async () => {
  const nowSec = Math.floor(Date.UTC(2026, 6, 8, 12, 0, 0) / 1000);

  await recordWebAnalyticsEvent({
    visitorId: 'visitor-returning-1',
    sessionId: 'session-old-1',
    eventType: 'pageview',
    path: '/news',
    acquisitionSource: 'direct',
    country: 'SA',
    occurredAt: nowSec - 10 * 86400,
  });
  await recordWebAnalyticsEvent({
    visitorId: 'visitor-returning-1',
    sessionId: 'session-today-1',
    eventType: 'pageview',
    path: '/tournaments/1',
    acquisitionSource: 'google',
    campaign: 'summer_launch',
    country: 'SA',
    occurredAt: nowSec,
  });
  await recordWebAnalyticsEvent({
    visitorId: 'visitor-new-2',
    sessionId: 'session-today-2',
    eventType: 'pageview',
    path: '/tournaments/1?utm_source=x&utm_campaign=social_news#results',
    acquisitionSource: 'x',
    campaign: 'social_news',
    country: 'AE',
    occurredAt: nowSec,
  });
  await recordWebAnalyticsEvent({
    visitorId: 'visitor-new-2',
    sessionId: 'session-today-2',
    eventType: 'engagement',
    path: '/tournaments/1',
    acquisitionSource: 'x',
    campaign: 'social_news',
    country: 'AE',
    durationSeconds: 45,
    occurredAt: nowSec + 20,
  });

  const dashboard = await getWebAnalyticsDashboard({ nowSec, days: 30 });

  assert.equal(dashboard.periods.today.visitors, 2);
  assert.equal(dashboard.periods.today.returningVisitors, 1);
  assert.equal(dashboard.periods.today.sessions, 2);
  assert.equal(dashboard.periods.today.pageviews, 2);
  assert.equal(dashboard.periods.today.engagementSeconds, 45);
  assert.equal(dashboard.periods.today.avgSecondsPerSession, 23);

  assert.equal(dashboard.periods.thirtyDays.visitors, 2);
  assert.equal(dashboard.totalKnownVisitors, 2);
  assert.deepEqual(
    dashboard.countries.map((row) => [row.country, row.visitors, row.pageviews]),
    [
      ['SA', 1, 2],
      ['AE', 1, 1],
    ],
  );
  assert.deepEqual(
    dashboard.pages.map((row) => [row.path, row.pageviews]),
    [
      ['/tournaments/1', 2],
      ['/news', 1],
    ],
  );
  assert.deepEqual(
    dashboard.acquisition.map((row) => [row.source, row.visitors, row.pageviews]),
    [
      ['direct', 1, 1],
      ['google', 1, 1],
      ['x', 1, 1],
    ],
  );
  assert.deepEqual(
    dashboard.campaigns.map((row) => [row.source, row.campaign, row.pageviews]),
    [
      ['x', 'social_news', 1],
      ['google', 'summer_launch', 1],
    ],
  );
  assert.equal(dashboard.daily.at(-1).visitors, 2);
});

test('classifies legacy referrers before removing the raw field', () => {
  assert.deepEqual(migratedLegacyRows, [
    { visitor_id: 'legacy-bing', acquisition_source: 'bing' },
    { visitor_id: 'legacy-direct', acquisition_source: 'direct' },
    { visitor_id: 'legacy-discord', acquisition_source: 'discord' },
    { visitor_id: 'legacy-discord-legacy', acquisition_source: 'discord' },
    { visitor_id: 'legacy-google', acquisition_source: 'google' },
    { visitor_id: 'legacy-google-country', acquisition_source: 'google' },
    { visitor_id: 'legacy-google-lookalike', acquisition_source: 'other_referral' },
    { visitor_id: 'legacy-internal', acquisition_source: 'direct' },
    { visitor_id: 'legacy-referral', acquisition_source: 'other_referral' },
    { visitor_id: 'legacy-x', acquisition_source: 'x' },
    { visitor_id: 'legacy-x-shortener', acquisition_source: 'x' },
  ]);
  assert.equal(migratedLegacyColumns.some((column) => column.name === 'referrer'), false);
  assert.equal(migratedLegacyCount, 11);
  assert.deepEqual(productTableExists, { name: 'web_product_events' });
});

test('rejects acquisition values outside the privacy-safe contract', async () => {
  const event = {
    visitorId: 'visitor-validation-1',
    sessionId: 'session-validation-1',
    eventType: 'pageview',
    path: '/news/validation',
  };

  await assert.rejects(
    recordWebAnalyticsEvent({ ...event, acquisitionSource: 'newsletter' }),
    /Invalid analytics acquisition source/,
  );
  await assert.rejects(
    recordWebAnalyticsEvent({ ...event, acquisitionSource: 'discord', campaign: 'Raw Query Value' }),
    /Invalid analytics campaign/,
  );
  await assert.rejects(
    recordWebAnalyticsEvent({ ...event, acquisitionSource: 'discord', campaign: 'a'.repeat(65) }),
    /Invalid analytics campaign/,
  );
});

test('SQLite and Postgres schemas replace raw referrers with bounded acquisition fields', () => {
  const sqliteColumns = db.prepare('PRAGMA table_info(web_analytics_events)').all().map((column) => column.name);
  assert.ok(sqliteColumns.includes('acquisition_source'));
  assert.ok(sqliteColumns.includes('campaign'));
  assert.ok(!sqliteColumns.includes('referrer'));

  const postgres = readFileSync(join(process.cwd(), 'scripts/postgres/schema.sql'), 'utf8');
  assert.match(postgres, /acquisition_source TEXT NOT NULL DEFAULT 'direct'/);
  assert.match(postgres, /campaign ~ '\^\[a-z0-9\]/);
  assert.match(postgres, /DROP COLUMN IF EXISTS referrer/);
});

test('records only allowlisted product events and aggregates anonymous sessions', async () => {
  const nowSec = Math.floor(Date.UTC(2026, 6, 9, 12, 0, 0) / 1000);
  const base = {
    visitorId: 'product-visitor-1',
    sessionId: 'product-session-1',
    path: '/predictions?club=private#save',
    acquisitionSource: 'discord',
    campaign: 'prediction_launch',
    country: 'SA',
    occurredAt: nowSec,
  };
  await recordWebProductEvent({ ...base, eventName: 'prediction_submit' });
  await recordWebProductEvent({ ...base, eventName: 'prediction_submit', occurredAt: nowSec + 1 });
  await recordWebProductEvent({
    ...base,
    visitorId: 'product-visitor-2',
    sessionId: 'product-session-2',
    eventName: 'follow_create',
    occurredAt: nowSec + 2,
  });

  const summary = await getWebProductAnalytics({ nowSec, days: 30, sessionCount: 4 });
  assert.deepEqual(summary.events, [
    { eventName: 'prediction_submit', events: 2, sessions: 1, conversionRate: 25 },
    { eventName: 'follow_create', events: 1, sessions: 1, conversionRate: 25 },
  ]);
  assert.equal(summary.daily.at(-1).counts.prediction_submit, 2);
  assert.equal(summary.daily.at(-1).counts.follow_create, 1);
  const stored = db.prepare("SELECT path FROM web_product_events WHERE visitor_id = 'product-visitor-1'").get();
  assert.deepEqual(stored, { path: '/predictions' });
  assert.equal(
    db.prepare('PRAGMA table_info(web_product_events)').all().some((column) => column.name === 'user_agent'),
    false,
  );

  await assert.rejects(
    recordWebProductEvent({ ...base, eventName: 'prediction_submit; DROP TABLE web_product_events' }),
    /CHECK constraint failed/,
  );
  await assert.rejects(
    recordWebProductEvent({ ...base, eventName: 'unknown_event' }),
    /CHECK constraint failed/,
  );
});

test('keeps the product-event schema equivalent across SQLite, Postgres, and migrations', () => {
  const sqliteColumns = db.prepare('PRAGMA table_info(web_product_events)').all().map((column) => column.name);
  assert.deepEqual(sqliteColumns, [
    'id',
    'visitor_id',
    'session_id',
    'event_name',
    'path',
    'acquisition_source',
    'campaign',
    'country',
    'occurred_at',
  ]);
  const postgres = readFileSync(join(process.cwd(), 'scripts/postgres/schema.sql'), 'utf8');
  assert.match(postgres, /CREATE TABLE IF NOT EXISTS web_product_events/);
  assert.match(postgres, /event_name\s+TEXT NOT NULL CHECK \(event_name IN \(/);
  assert.match(postgres, /'discord_join_click'/);
  assert.match(postgres, /CREATE INDEX IF NOT EXISTS idx_web_product_events_occurred/);
  assert.doesNotMatch(postgres.match(/CREATE TABLE IF NOT EXISTS web_product_events[\s\S]*?\n\);/)?.[0] || '', /user_agent/);
  assert.ok(appTables.includes('web_product_events'));
  assert.equal(identityColumns.get('web_product_events'), 'id');
});

test('purges only analytics events older than the injected ninety-day cutoff', async () => {
  const cutoff = Math.floor(Date.UTC(2026, 6, 10, 0, 0, 0) / 1000) - 90 * 86400;
  await recordWebAnalyticsEvent({
    visitorId: 'retention-expired-traffic',
    sessionId: 'retention-expired-traffic',
    eventType: 'pageview',
    path: '/retention-expired',
    acquisitionSource: 'direct',
    occurredAt: cutoff - 1,
  });
  await recordWebAnalyticsEvent({
    visitorId: 'retention-kept-traffic',
    sessionId: 'retention-kept-traffic',
    eventType: 'pageview',
    path: '/retention-kept',
    acquisitionSource: 'direct',
    occurredAt: cutoff,
  });
  await recordWebProductEvent({
    visitorId: 'retention-expired-product',
    sessionId: 'retention-expired-product',
    eventName: 'discord_join_click',
    path: '/',
    acquisitionSource: 'direct',
    occurredAt: cutoff - 1,
  });
  await recordWebProductEvent({
    visitorId: 'retention-kept-product',
    sessionId: 'retention-kept-product',
    eventName: 'discord_join_click',
    path: '/',
    acquisitionSource: 'direct',
    occurredAt: cutoff,
  });

  assert.deepEqual(await purgeWebAnalyticsRetention({ cutoff }), { webEvents: 1, productEvents: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM web_analytics_events WHERE visitor_id = 'retention-expired-traffic'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM web_product_events WHERE visitor_id = 'retention-expired-product'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM web_analytics_events WHERE visitor_id = 'retention-kept-traffic'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM web_product_events WHERE visitor_id = 'retention-kept-product'").get().count, 1);
  assert.deepEqual(await purgeWebAnalyticsRetention({ cutoff }), { webEvents: 0, productEvents: 0 });
});

