process.env.EWC_ANALYTICS_SOURCE_RATE_LIMIT_PER_HOUR = "2";
process.env.EWC_ANALYTICS_VISITOR_RATE_LIMIT_PER_HOUR = "50";

import { describe, expect, test } from "vitest";
import { POST } from "@/app/api/analytics/event/route";
import { getAnalyticsDashboard } from "@/lib/web-analytics";

function analyticsRequest(
  visitorId: string,
  sessionId: string,
  ip: string,
  overrides: Record<string, unknown> = {},
) {
  return new Request("http://localhost/api/analytics/event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "cf-connecting-ip": ip,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({
      visitorId,
      sessionId,
      eventType: "pageview",
      path: "/news/security-test",
      acquisitionSource: "direct",
      ...overrides,
    }),
  });
}

describe("analytics ingestion rate limiting", () => {
  test("limits one Cloudflare source even when visitor IDs rotate", async () => {
    const ip = "203.0.113.10";

    expect((await POST(analyticsRequest("visitorid0000001", "sessionid0000001", ip))).status).toBe(204);
    expect((await POST(analyticsRequest("visitorid0000002", "sessionid0000002", ip))).status).toBe(204);

    const blocked = await POST(analyticsRequest("visitorid0000003", "sessionid0000003", ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  test("keeps separate source buckets for different Cloudflare IPs", async () => {
    const response = await POST(
      analyticsRequest("visitorid0000004", "sessionid0000004", "203.0.113.11"),
    );
    expect(response.status).toBe(204);
  });
});

describe("analytics acquisition ingestion", () => {
  test("stores only allowlisted source, bounded campaign, and a query-free path", async () => {
    const response = await POST(
      analyticsRequest("visitoracquisition01", "sessionacquisition01", "203.0.113.20", {
        path: "/news/acquisition-test?private=value#fragment",
        acquisitionSource: "x",
        campaign: "news_share",
        referrer: "https://example.com/private/path?token=secret",
      }),
    );
    expect(response.status).toBe(204);

    const dashboard = await getAnalyticsDashboard({ days: 30 });
    expect(dashboard.pages.find((page) => page.path === "/news/acquisition-test")?.pageviews).toBe(1);
    expect(dashboard.pages.some((page) => page.path.includes("private=value"))).toBe(false);
    expect(dashboard.campaigns).toContainEqual({
      source: "x",
      campaign: "news_share",
      visitors: 1,
      sessions: 1,
      pageviews: 1,
    });
  });

  test("silently rejects unknown sources and unbounded campaign values", async () => {
    await POST(
      analyticsRequest("visitoracquisition02", "sessionacquisition02", "203.0.113.21", {
        path: "/news/invalid-source",
        acquisitionSource: "newsletter",
      }),
    );
    await POST(
      analyticsRequest("visitoracquisition03", "sessionacquisition03", "203.0.113.22", {
        path: "/news/invalid-campaign",
        acquisitionSource: "discord",
        campaign: "includes a raw query?secret=yes",
      }),
    );

    const dashboard = await getAnalyticsDashboard({ days: 30 });
    expect(dashboard.pages.some((page) => page.path === "/news/invalid-source")).toBe(false);
    expect(dashboard.pages.some((page) => page.path === "/news/invalid-campaign")).toBe(false);
  });
});
