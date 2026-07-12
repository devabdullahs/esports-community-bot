import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'web-analytics-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb, db } = await import('../src/db/index.js');
const { getWebAnalyticsDashboard, recordWebAnalyticsEvent } = await import('../src/db/webAnalytics.js');

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

