import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'web-analytics-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
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
    country: 'SA',
    occurredAt: nowSec - 10 * 86400,
  });
  await recordWebAnalyticsEvent({
    visitorId: 'visitor-returning-1',
    sessionId: 'session-today-1',
    eventType: 'pageview',
    path: '/tournaments/1',
    country: 'SA',
    occurredAt: nowSec,
  });
  await recordWebAnalyticsEvent({
    visitorId: 'visitor-new-2',
    sessionId: 'session-today-2',
    eventType: 'pageview',
    path: '/tournaments/1',
    country: 'AE',
    occurredAt: nowSec,
  });
  await recordWebAnalyticsEvent({
    visitorId: 'visitor-new-2',
    sessionId: 'session-today-2',
    eventType: 'engagement',
    path: '/tournaments/1',
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
  assert.equal(dashboard.daily.at(-1).visitors, 2);
});

