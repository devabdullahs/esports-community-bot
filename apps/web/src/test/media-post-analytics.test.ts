import { describe, expect, test } from "vitest";
import { createEwcNewsPost } from "@bot/db/ewcNewsPosts.js";
import { getNewsPostAnalytics, recordWebAnalyticsEvent } from "@bot/db/webAnalytics.js";

const nowSec = 1_800_000_000;
const suffix = `${process.pid}-${Date.now()}`;
const mediaSlug = `analytics-media-${suffix}`;
const otherMediaSlug = `analytics-other-${suffix}`;
const gameSlug = `analytics-game-${suffix}`;
const privateVisitor = "visitor-private-analytics-id";
const privateSession = "session-private-analytics-id";
const createNewsPost = createEwcNewsPost as unknown as (input: unknown) => Promise<{ id: number }>;
const recordAnalyticsEvent = recordWebAnalyticsEvent as unknown as (input: {
  visitorId: string;
  sessionId: string;
  eventType: "pageview" | "engagement";
  path: string;
  acquisitionSource: "direct" | "x" | "discord" | "google" | "bing" | "other_referral";
  campaign?: string | null;
  country?: string | null;
  durationSeconds?: number;
  occurredAt: number;
}) => Promise<void>;
const getPostAnalytics = getNewsPostAnalytics as unknown as (input: {
  gameSlug?: string | null;
  mediaSlug?: string | null;
  nowSec?: number;
  days?: number;
}) => Promise<{
  posts: Array<{ postId: number; pageviews: number; visitors: number; sessions: number; engagementSeconds: number; avgSecondsPerPageview: number }>;
  totals: { pageviews: number; visitors: number; sessions: number; engagementSeconds: number };
  acquisition: Array<{ source: string; pageviews: number; visitors: number }>;
  countries: Array<{ country: string }>;
  daily: Array<{ pageviews: number }>;
}>;

async function createPost(input: { mediaSlug?: string; gameSlug?: string; title: string }) {
  return createNewsPost({
    ...input,
    contentMode: "shared",
    defaultLocale: "en",
    translations: { en: { title: input.title, summary: "Summary", body: "Body" } },
    status: "published",
    authorDiscordId: null,
    authorName: null,
    coverImageUrl: null,
  }) as Promise<{ id: number }>;
}

async function record(input: {
  visitorId: string;
  sessionId: string;
  eventType: "pageview" | "engagement";
  path: string;
  acquisitionSource: "direct" | "x" | "discord" | "google" | "bing" | "other_referral";
  campaign?: string;
  country?: string;
  durationSeconds?: number;
}) {
  await recordAnalyticsEvent({
    ...input,
    occurredAt: nowSec - 3600,
  });
}

describe("news post analytics", () => {
  test("aggregates one media channel by post path without returning raw identifiers", async () => {
    const [mediaPost, otherMediaPost, gamePost] = await Promise.all([
      createPost({ mediaSlug, title: "Scoped media post" }),
      createPost({ mediaSlug: otherMediaSlug, title: "Other media post" }),
      createPost({ gameSlug, title: "Scoped game post" }),
    ]);

    await Promise.all([
      record({
        visitorId: privateVisitor,
        sessionId: privateSession,
        eventType: "pageview",
        path: `/media/${mediaSlug}/news/${mediaPost.id}`,
        acquisitionSource: "x",
        campaign: "launch-week",
        country: "SA",
      }),
      record({
        visitorId: privateVisitor,
        sessionId: privateSession,
        eventType: "engagement",
        path: `/media/${mediaSlug}/news/${mediaPost.id}`,
        acquisitionSource: "x",
        country: "SA",
        durationSeconds: 45,
      }),
      record({
        visitorId: "visitor-second-private-id",
        sessionId: "session-second-private-id",
        eventType: "pageview",
        path: `/ar/media/${mediaSlug}/news/${mediaPost.id}`,
        acquisitionSource: "discord",
        country: "US",
      }),
      record({
        visitorId: "visitor-other-private-id",
        sessionId: "session-other-private-id",
        eventType: "pageview",
        path: `/media/${otherMediaSlug}/news/${otherMediaPost.id}`,
        acquisitionSource: "google",
        country: "GB",
      }),
      record({
        visitorId: "visitor-game-private-id",
        sessionId: "session-game-private-id",
        eventType: "pageview",
        path: `/games/${gameSlug}/news/${gamePost.id}`,
        acquisitionSource: "direct",
        country: "AE",
      }),
    ]);

    const analytics = await getPostAnalytics({ mediaSlug, nowSec, days: 7 });

    expect(analytics.posts).toEqual([
      expect.objectContaining({
        postId: mediaPost.id,
        pageviews: 2,
        visitors: 2,
        sessions: 2,
        engagementSeconds: 45,
        avgSecondsPerPageview: 23,
      }),
    ]);
    expect(analytics.totals).toMatchObject({ pageviews: 2, visitors: 2, sessions: 2, engagementSeconds: 45 });
    expect(analytics.acquisition).toEqual([
      expect.objectContaining({ source: "discord", pageviews: 1, visitors: 1 }),
      expect.objectContaining({ source: "x", pageviews: 1, visitors: 1 }),
    ]);
    expect((analytics as unknown as { campaigns: unknown[] }).campaigns).toEqual([
      expect.objectContaining({ source: "x", campaign: "launch-week", pageviews: 1, visitors: 1 }),
    ]);
    expect(analytics.countries.map((country) => country.country)).toEqual(["SA", "US"]);
    expect(analytics.daily).toHaveLength(7);
    expect(analytics.daily.reduce((sum, day) => sum + day.pageviews, 0)).toBe(2);

    const serialized = JSON.stringify(analytics);
    expect(serialized).not.toContain(privateVisitor);
    expect(serialized).not.toContain(privateSession);
    expect(serialized).not.toContain("visitor-second-private-id");
    expect(serialized).not.toContain("session-second-private-id");
  });

  test("keeps game-owned posts separate from media-owned posts", async () => {
    const analytics = await getPostAnalytics({ gameSlug, nowSec, days: 7 });

    expect(analytics.posts).toHaveLength(1);
    expect(analytics.posts[0]).toMatchObject({ pageviews: 1, visitors: 1 });
    expect(analytics.posts[0]?.postId).not.toBeNull();
  });
});
