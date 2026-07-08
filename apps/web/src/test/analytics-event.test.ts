process.env.EWC_ANALYTICS_SOURCE_RATE_LIMIT_PER_HOUR = "2";
process.env.EWC_ANALYTICS_VISITOR_RATE_LIMIT_PER_HOUR = "50";

import { describe, expect, test } from "vitest";
import { POST } from "@/app/api/analytics/event/route";

function analyticsRequest(visitorId: string, sessionId: string, ip: string) {
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
