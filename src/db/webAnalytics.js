import { all, run, transaction } from './client.js';

const RIYADH_OFFSET_SECONDS = 3 * 60 * 60;
const EVENT_TYPES = new Set(['pageview', 'engagement']);
const ACQUISITION_SOURCES = new Set(['direct', 'x', 'discord', 'google', 'bing', 'other_referral']);
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function clampInt(value, min, max) {
  const n = Math.trunc(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}

function cleanString(value, maxLength) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, maxLength);
}

function cleanPath(value) {
  const s = cleanString(value, 300);
  if (!s || !s.startsWith('/')) return '/';
  return s.split(/[?#]/, 1)[0].slice(0, 300) || '/';
}

function cleanAcquisitionSource(value) {
  const source = String(value || '').trim();
  return ACQUISITION_SOURCES.has(source) ? source : null;
}

function cleanCampaign(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !CAMPAIGN_RE.test(value)) return null;
  return value;
}

function cleanCountry(value) {
  const s = cleanString(value, 16);
  if (!s) return null;
  const upper = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  if (upper === 'XX' || upper === 'T1') return upper;
  return null;
}

function dayKeyFor(sec) {
  return Math.floor((Number(sec) + RIYADH_OFFSET_SECONDS) / 86400);
}

function startOfRiyadhDay(sec) {
  const key = dayKeyFor(sec);
  return key * 86400 - RIYADH_OFFSET_SECONDS;
}

function dateLabelForDayKey(key) {
  return new Date((key * 86400 - RIYADH_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

function emptyMetric(label, since) {
  return {
    label,
    since,
    pageviews: 0,
    visitors: 0,
    sessions: 0,
    returningVisitors: 0,
    engagementSeconds: 0,
    avgSecondsPerSession: 0,
    avgSecondsPerPageview: 0,
  };
}

function summarizePeriod(label, rows, firstSeenByVisitor, since) {
  const metric = emptyMetric(label, since);
  const visitors = new Set();
  const sessions = new Set();

  for (const row of rows) {
    if (Number(row.occurred_at) < since) continue;
    if (row.visitor_id) visitors.add(row.visitor_id);
    if (row.session_id) sessions.add(row.session_id);
    if (row.event_type === 'pageview') metric.pageviews += 1;
    metric.engagementSeconds += clampInt(row.duration_seconds, 0, 300);
  }

  metric.visitors = visitors.size;
  metric.sessions = sessions.size;
  metric.returningVisitors = [...visitors].filter((id) => {
    const firstSeen = firstSeenByVisitor.get(id);
    return Number.isFinite(firstSeen) && firstSeen < since;
  }).length;
  metric.avgSecondsPerSession = sessions.size ? Math.round(metric.engagementSeconds / sessions.size) : 0;
  metric.avgSecondsPerPageview = metric.pageviews ? Math.round(metric.engagementSeconds / metric.pageviews) : 0;
  return metric;
}

function topCountries(rows, since, limit) {
  const countries = new Map();
  for (const row of rows) {
    if (Number(row.occurred_at) < since) continue;
    const country = cleanCountry(row.country) || 'XX';
    const entry = countries.get(country) || { country, visitors: new Set(), pageviews: 0, sessions: new Set() };
    if (row.visitor_id) entry.visitors.add(row.visitor_id);
    if (row.session_id) entry.sessions.add(row.session_id);
    if (row.event_type === 'pageview') entry.pageviews += 1;
    countries.set(country, entry);
  }
  return [...countries.values()]
    .map((entry) => ({
      country: entry.country,
      visitors: entry.visitors.size,
      sessions: entry.sessions.size,
      pageviews: entry.pageviews,
    }))
    .sort((a, b) => b.visitors - a.visitors || b.pageviews - a.pageviews || a.country.localeCompare(b.country))
    .slice(0, limit);
}

function topPages(rows, since, limit) {
  const pages = new Map();
  for (const row of rows) {
    if (Number(row.occurred_at) < since || row.event_type !== 'pageview') continue;
    const path = cleanPath(row.path);
    const entry = pages.get(path) || { path, visitors: new Set(), pageviews: 0 };
    if (row.visitor_id) entry.visitors.add(row.visitor_id);
    entry.pageviews += 1;
    pages.set(path, entry);
  }
  return [...pages.values()]
    .map((entry) => ({
      path: entry.path,
      visitors: entry.visitors.size,
      pageviews: entry.pageviews,
    }))
    .sort((a, b) => b.pageviews - a.pageviews || b.visitors - a.visitors || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function acquisitionBreakdown(rows, since) {
  const sources = new Map();
  const campaigns = new Map();

  for (const row of rows) {
    if (Number(row.occurred_at) < since || row.event_type !== 'pageview') continue;
    const source = cleanAcquisitionSource(row.acquisition_source) || 'direct';
    const sourceEntry = sources.get(source) || { source, visitors: new Set(), sessions: new Set(), pageviews: 0 };
    if (row.visitor_id) sourceEntry.visitors.add(row.visitor_id);
    if (row.session_id) sourceEntry.sessions.add(row.session_id);
    sourceEntry.pageviews += 1;
    sources.set(source, sourceEntry);

    const campaign = cleanCampaign(row.campaign);
    if (!campaign) continue;
    const key = `${source}\0${campaign}`;
    const campaignEntry = campaigns.get(key) || {
      source,
      campaign,
      visitors: new Set(),
      sessions: new Set(),
      pageviews: 0,
    };
    if (row.visitor_id) campaignEntry.visitors.add(row.visitor_id);
    if (row.session_id) campaignEntry.sessions.add(row.session_id);
    campaignEntry.pageviews += 1;
    campaigns.set(key, campaignEntry);
  }

  const summarize = (entry) => ({
    source: entry.source,
    ...(entry.campaign ? { campaign: entry.campaign } : {}),
    visitors: entry.visitors.size,
    sessions: entry.sessions.size,
    pageviews: entry.pageviews,
  });
  const sort = (a, b) =>
    b.pageviews - a.pageviews || b.visitors - a.visitors ||
    String(a.campaign || a.source).localeCompare(String(b.campaign || b.source));

  return {
    acquisition: [...sources.values()].map(summarize).sort(sort),
    campaigns: [...campaigns.values()].map(summarize).sort(sort).slice(0, 12),
  };
}

function dailySeries(rows, nowSec, days) {
  const endKey = dayKeyFor(nowSec);
  const byDay = new Map();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = endKey - offset;
    byDay.set(key, {
      day: dateLabelForDayKey(key),
      pageviews: 0,
      visitors: new Set(),
      sessions: new Set(),
      engagementSeconds: 0,
    });
  }

  for (const row of rows) {
    const entry = byDay.get(dayKeyFor(row.occurred_at));
    if (!entry) continue;
    if (row.visitor_id) entry.visitors.add(row.visitor_id);
    if (row.session_id) entry.sessions.add(row.session_id);
    if (row.event_type === 'pageview') entry.pageviews += 1;
    entry.engagementSeconds += clampInt(row.duration_seconds, 0, 300);
  }

  return [...byDay.values()].map((entry) => ({
    day: entry.day,
    pageviews: entry.pageviews,
    visitors: entry.visitors.size,
    sessions: entry.sessions.size,
    engagementSeconds: entry.engagementSeconds,
  }));
}

function productEventSummary(rows, nowSec, days, sessionCount) {
  const byName = new Map();
  for (const row of rows) {
    const eventName = cleanString(row.event_name, 80);
    if (!eventName) continue;
    const entry = byName.get(eventName) || { eventName, events: 0, sessions: new Set() };
    entry.events += 1;
    if (row.session_id) entry.sessions.add(row.session_id);
    byName.set(eventName, entry);
  }

  const events = [...byName.values()]
    .map((entry) => ({
      eventName: entry.eventName,
      events: entry.events,
      sessions: entry.sessions.size,
      conversionRate: sessionCount ? Math.round((entry.sessions.size / sessionCount) * 10_000) / 100 : 0,
    }))
    .sort((a, b) => b.events - a.events || b.sessions - a.sessions || a.eventName.localeCompare(b.eventName))
    .slice(0, 6);
  const topNames = new Set(events.map((entry) => entry.eventName));
  const endKey = dayKeyFor(nowSec);
  const byDay = new Map();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = endKey - offset;
    byDay.set(key, { day: dateLabelForDayKey(key), counts: {} });
  }
  for (const row of rows) {
    const eventName = cleanString(row.event_name, 80);
    const entry = byDay.get(dayKeyFor(row.occurred_at));
    if (!eventName || !entry || !topNames.has(eventName)) continue;
    entry.counts[eventName] = (entry.counts[eventName] || 0) + 1;
  }

  return {
    events,
    daily: [...byDay.values()],
  };
}

export async function recordWebAnalyticsEvent({
  visitorId,
  sessionId,
  eventType,
  path,
  acquisitionSource,
  campaign = null,
  country = null,
  userAgent = null,
  durationSeconds = 0,
  occurredAt = Math.floor(Date.now() / 1000),
}) {
  const type = String(eventType || '').trim();
  if (!EVENT_TYPES.has(type)) throw new Error(`Invalid analytics event type: ${eventType}`);
  const visitor = cleanString(visitorId, 80);
  const session = cleanString(sessionId, 80);
  if (!visitor || !session) throw new Error('visitorId and sessionId are required');
  const source = cleanAcquisitionSource(acquisitionSource);
  if (!source) throw new Error(`Invalid analytics acquisition source: ${acquisitionSource}`);
  const campaignName = cleanCampaign(campaign);
  if (campaign != null && campaign !== '' && !campaignName) {
    throw new Error(`Invalid analytics campaign: ${campaign}`);
  }

  await run(
    `INSERT INTO web_analytics_events (
       visitor_id, session_id, event_type, path, acquisition_source, campaign, country, user_agent,
       duration_seconds, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      visitor,
      session,
      type,
      cleanPath(path),
      source,
      campaignName,
      cleanCountry(country),
      cleanString(userAgent, 240),
      type === 'engagement' ? clampInt(durationSeconds, 1, 300) : 0,
      clampInt(occurredAt, 1, 4_102_444_800),
    ],
  );
}

export async function recordWebProductEvent({
  visitorId,
  sessionId,
  eventName,
  path,
  acquisitionSource,
  campaign = null,
  country = null,
  occurredAt = Math.floor(Date.now() / 1000),
}) {
  const name = cleanString(eventName, 80);
  if (!name) throw new Error('eventName is required');
  const visitor = cleanString(visitorId, 80);
  const session = cleanString(sessionId, 80);
  if (!visitor || !session) throw new Error('visitorId and sessionId are required');
  const source = cleanAcquisitionSource(acquisitionSource);
  if (!source) throw new Error(`Invalid analytics acquisition source: ${acquisitionSource}`);
  const campaignName = cleanCampaign(campaign);
  if (campaign != null && campaign !== '' && !campaignName) {
    throw new Error(`Invalid analytics campaign: ${campaign}`);
  }

  await run(
    `INSERT INTO web_product_events (
       visitor_id, session_id, event_name, path, acquisition_source, campaign, country, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      visitor,
      session,
      name,
      cleanPath(path),
      source,
      campaignName,
      cleanCountry(country),
      clampInt(occurredAt, 1, 4_102_444_800),
    ],
  );
}

export async function getWebProductAnalytics({
  nowSec = Math.floor(Date.now() / 1000),
  days = 30,
  sessionCount = 0,
} = {}) {
  const safeDays = clampInt(days, 7, 120);
  const since = startOfRiyadhDay(nowSec) - (safeDays - 1) * 86400;
  const rows = await all(
    `SELECT event_name, session_id, occurred_at
     FROM web_product_events
     WHERE occurred_at >= $1
     ORDER BY occurred_at ASC`,
    [since],
  );
  return productEventSummary(rows, nowSec, safeDays, clampInt(sessionCount, 0, Number.MAX_SAFE_INTEGER));
}

export async function purgeWebAnalyticsEvents(cutoff) {
  const safeCutoff = clampInt(cutoff, 1, 4_102_444_800);
  return transaction(async (client) => {
    const webEvents = await client.run('DELETE FROM web_analytics_events WHERE occurred_at < $1', [safeCutoff]);
    const productEvents = await client.run('DELETE FROM web_product_events WHERE occurred_at < $1', [safeCutoff]);
    return {
      webEvents: webEvents.rowCount,
      productEvents: productEvents.rowCount,
    };
  });
}

export async function getWebAnalyticsDashboard({ nowSec = Math.floor(Date.now() / 1000), days = 30 } = {}) {
  const safeDays = clampInt(days, 7, 120);
  const todaySince = startOfRiyadhDay(nowSec);
  const sevenDaySince = todaySince - 6 * 86400;
  const thirtyDaySince = todaySince - 29 * 86400;
  const periodSince = todaySince - (safeDays - 1) * 86400;
  const fetchSince = Math.min(periodSince, thirtyDaySince);
  const rows = await all(
    `SELECT visitor_id, session_id, event_type, path, acquisition_source, campaign, country, duration_seconds, occurred_at
     FROM web_analytics_events
     WHERE occurred_at >= $1
     ORDER BY occurred_at ASC`,
    [fetchSince],
  );
  const firstSeenRows = await all(
    `SELECT visitor_id, MIN(occurred_at) AS first_seen
     FROM web_analytics_events
     GROUP BY visitor_id`,
  );
  const firstSeenByVisitor = new Map(
    firstSeenRows.map((row) => [row.visitor_id, Number(row.first_seen)]),
  );
  const acquisition = acquisitionBreakdown(rows, periodSince);
  const selected = summarizePeriod(`Last ${safeDays} days`, rows, firstSeenByVisitor, periodSince);
  const productEvents = await getWebProductAnalytics({
    nowSec,
    days: safeDays,
    sessionCount: selected.sessions,
  });

  return {
    generatedAt: nowSec,
    timezone: 'Asia/Riyadh',
    periods: {
      today: summarizePeriod('Today', rows, firstSeenByVisitor, todaySince),
      sevenDays: summarizePeriod('Last 7 days', rows, firstSeenByVisitor, sevenDaySince),
      thirtyDays: summarizePeriod('Last 30 days', rows, firstSeenByVisitor, thirtyDaySince),
      selected,
    },
    countries: topCountries(rows, periodSince, 12),
    pages: topPages(rows, periodSince, 12),
    acquisition: acquisition.acquisition,
    campaigns: acquisition.campaigns,
    daily: dailySeries(rows, nowSec, Math.min(30, safeDays)),
    productEvents,
    totalKnownVisitors: firstSeenByVisitor.size,
  };
}
