import "server-only";

import {
  ensurePostgresAppSchema as _ensurePostgresAppSchema,
} from "@bot/db/client.js";
import {
  getWebAnalyticsDashboard as _getWebAnalyticsDashboard,
  getWebProductAnalytics as _getWebProductAnalytics,
  recordWebAnalyticsEvent as _recordWebAnalyticsEvent,
  recordWebProductEvent as _recordWebProductEvent,
} from "@bot/db/webAnalytics.js";
import type { ProductEventName } from "@/lib/product-analytics";

export type AnalyticsMetric = {
  label: string;
  since: number;
  pageviews: number;
  visitors: number;
  sessions: number;
  returningVisitors: number;
  engagementSeconds: number;
  avgSecondsPerSession: number;
  avgSecondsPerPageview: number;
};

export type AnalyticsCountry = {
  country: string;
  visitors: number;
  sessions: number;
  pageviews: number;
};

export type AnalyticsPage = {
  path: string;
  visitors: number;
  pageviews: number;
};

export type AnalyticsAcquisitionSource = "direct" | "x" | "discord" | "google" | "bing" | "other_referral";

export type AnalyticsAcquisition = {
  source: AnalyticsAcquisitionSource;
  visitors: number;
  sessions: number;
  pageviews: number;
};

export type AnalyticsCampaign = AnalyticsAcquisition & {
  campaign: string;
};

export type AnalyticsDay = {
  day: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  engagementSeconds: number;
};

export type AnalyticsProductEvent = {
  eventName: ProductEventName;
  events: number;
  sessions: number;
  conversionRate: number;
};

export type AnalyticsProductEventDay = {
  day: string;
  counts: Partial<Record<ProductEventName, number>>;
};

export type AnalyticsProductEvents = {
  events: AnalyticsProductEvent[];
  daily: AnalyticsProductEventDay[];
};

export type AnalyticsDashboard = {
  generatedAt: number;
  timezone: string;
  totalKnownVisitors: number;
  periods: {
    today: AnalyticsMetric;
    sevenDays: AnalyticsMetric;
    thirtyDays: AnalyticsMetric;
    selected: AnalyticsMetric;
  };
  countries: AnalyticsCountry[];
  pages: AnalyticsPage[];
  acquisition: AnalyticsAcquisition[];
  campaigns: AnalyticsCampaign[];
  daily: AnalyticsDay[];
  productEvents: AnalyticsProductEvents;
};

type AnalyticsEventInput = {
  visitorId: string;
  sessionId: string;
  eventType: "pageview" | "engagement";
  path: string;
  acquisitionSource: AnalyticsAcquisitionSource;
  campaign?: string | null;
  country?: string | null;
  userAgent?: string | null;
  durationSeconds?: number;
  occurredAt?: number;
};

type ProductAnalyticsEventInput = Omit<AnalyticsEventInput, "eventType" | "durationSeconds" | "userAgent"> & {
  eventName: ProductEventName;
};

const ensurePostgresAppSchema = _ensurePostgresAppSchema as unknown as () => Promise<void>;
const recordWebAnalyticsEvent = _recordWebAnalyticsEvent as unknown as (input: AnalyticsEventInput) => Promise<void>;
const recordWebProductEvent = _recordWebProductEvent as unknown as (input: ProductAnalyticsEventInput) => Promise<void>;
const getWebAnalyticsDashboard = _getWebAnalyticsDashboard as unknown as (input?: {
  nowSec?: number;
  days?: number;
}) => Promise<AnalyticsDashboard>;
const getWebProductAnalytics = _getWebProductAnalytics as unknown as (input?: {
  nowSec?: number;
  days?: number;
  sessionCount?: number;
}) => Promise<AnalyticsProductEvents>;

let schemaPromise: Promise<void> | null = null;

async function ensureSchemaOnce() {
  schemaPromise ??= ensurePostgresAppSchema();
  await schemaPromise;
}

export async function ensureAnalyticsSchema(): Promise<void> {
  await ensureSchemaOnce();
}

export async function recordAnalyticsEvent(input: AnalyticsEventInput): Promise<void> {
  await ensureSchemaOnce();
  await recordWebAnalyticsEvent(input);
}

export async function recordProductAnalyticsEvent(input: ProductAnalyticsEventInput): Promise<void> {
  await ensureSchemaOnce();
  await recordWebProductEvent(input);
}

export async function getProductAnalytics(input?: {
  nowSec?: number;
  days?: number;
  sessionCount?: number;
}): Promise<AnalyticsProductEvents> {
  await ensureSchemaOnce();
  return getWebProductAnalytics(input);
}

export async function getAnalyticsDashboard(input?: { nowSec?: number; days?: number }): Promise<AnalyticsDashboard> {
  await ensureSchemaOnce();
  return getWebAnalyticsDashboard(input);
}
