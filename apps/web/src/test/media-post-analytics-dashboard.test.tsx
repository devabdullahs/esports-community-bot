import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { PostAnalyticsDashboard } from "@/components/admin/post-analytics-dashboard";
import type { PostAnalyticsDashboard as AnalyticsData } from "@/lib/web-analytics";

vi.mock("@/components/admin/analytics-trend-chart", () => ({
  AnalyticsTrendChart: () => <div data-chart="post-traffic" />,
}));

const emptyAnalytics: AnalyticsData = {
  generatedAt: 1_800_000_000,
  timezone: "Asia/Riyadh",
  days: 30,
  since: 1_797_494_400,
  totals: { pageviews: 0, visitors: 0, sessions: 0, engagementSeconds: 0, avgSecondsPerSession: 0, avgSecondsPerPageview: 0 },
  posts: [],
  countries: [],
  acquisition: [],
  campaigns: [],
  daily: [],
};

function render(analytics = emptyAnalytics, postTitles = new Map<number, string>()) {
  return renderToStaticMarkup(
    <PostAnalyticsDashboard analytics={analytics} postTitles={postTitles} locale="en" />,
  );
}

describe("post analytics dashboard", () => {
  test("renders a clear empty state", () => {
    const html = render();

    expect(html).toContain("No published posts with analytics yet.");
    expect(html).not.toContain('data-chart="post-traffic"');
  });

  test("renders one post with aggregate metrics only", () => {
    const html = render(
      {
        ...emptyAnalytics,
        totals: { pageviews: 4, visitors: 2, sessions: 2, engagementSeconds: 80, avgSecondsPerSession: 40, avgSecondsPerPageview: 20 },
        posts: [{ postId: 12, publishedAt: null, pageviews: 4, visitors: 2, sessions: 2, engagementSeconds: 80, avgSecondsPerSession: 40, avgSecondsPerPageview: 20 }],
        daily: [{ day: "2027-01-14", pageviews: 4, visitors: 2, sessions: 2, engagementSeconds: 80 }],
        acquisition: [{ source: "discord" as const, pageviews: 4, visitors: 2, sessions: 2 }],
      },
      new Map([[12, "One post"]]),
    );

    expect(html).toContain("One post");
    expect(html).toContain("Traffic sources");
    expect(html).toContain('data-chart="post-traffic"');
    expect(html).not.toContain("visitor_id");
    expect(html).not.toContain("session_id");
  });

  test("renders a comparison table for multiple posts", () => {
    const html = render(
      {
        ...emptyAnalytics,
        posts: [
          { postId: 20, publishedAt: null, pageviews: 8, visitors: 5, sessions: 5, engagementSeconds: 80, avgSecondsPerSession: 16, avgSecondsPerPageview: 10 },
          { postId: 19, publishedAt: null, pageviews: 3, visitors: 2, sessions: 2, engagementSeconds: 30, avgSecondsPerSession: 15, avgSecondsPerPageview: 10 },
        ],
      },
      new Map([[20, "Leading post"], [19, "Second post"]]),
    );

    expect(html).toContain("Post comparison");
    expect(html).toContain("Leading post");
    expect(html).toContain("Second post");
  });
});
