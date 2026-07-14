import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getRequestLocale = vi.fn();
const getAnalyticsDashboard = vi.fn();

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  getAdminAccess: vi.fn().mockResolvedValue({ session: { user: { id: "admin" } }, isSuper: true }),
}));
vi.mock("@/lib/admin-copy", () => ({
  getAdminCopy: () => ({ dashboard: { title: "Dashboard" } }),
}));
vi.mock("@/lib/request-locale", () => ({ getRequestLocale }));
vi.mock("@/lib/web-analytics", () => ({ getAnalyticsDashboard }));
vi.mock("@/components/admin/admin-page-shell", () => ({
  AdminPageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/admin/analytics-trend-chart", () => ({
  AnalyticsTrendChart: () => <div data-chart="traffic" />,
  ProductEventsTrendChart: ({ eventNames }: { eventNames: string[] }) => (
    <div data-chart="product">{eventNames.join(",")}</div>
  ),
}));

const dashboard = {
  generatedAt: 1_784_232_000,
  timezone: "Asia/Riyadh",
  totalKnownVisitors: 3,
  periods: {
    today: { visitors: 1, returningVisitors: 0, sessions: 1, pageviews: 1, engagementSeconds: 0, avgSecondsPerSession: 0 },
    sevenDays: { visitors: 2, returningVisitors: 1, sessions: 2, pageviews: 2, engagementSeconds: 20, avgSecondsPerSession: 10 },
    thirtyDays: { visitors: 3, returningVisitors: 1, sessions: 4, pageviews: 5, engagementSeconds: 30, avgSecondsPerSession: 8 },
    selected: { visitors: 3, returningVisitors: 1, sessions: 4, pageviews: 5, engagementSeconds: 30, avgSecondsPerSession: 8 },
  },
  countries: [],
  pages: [],
  acquisition: [],
  campaigns: [],
  daily: [],
  productEvents: {
    events: [{ eventName: "prediction_submit", events: 2, sessions: 1, conversionRate: 25 }],
    daily: [{ day: "2026-07-14", counts: { prediction_submit: 2 } }],
  },
};

beforeEach(() => {
  getAnalyticsDashboard.mockResolvedValue(dashboard);
  getRequestLocale.mockResolvedValue("en");
});

async function renderPage() {
  const { default: AdminAnalyticsPage } = await import("@/app/admin/analytics/page");
  return renderToStaticMarkup(await AdminAnalyticsPage());
}

describe("admin product analytics", () => {
  test("renders aggregate product events without raw identifiers", async () => {
    const html = await renderPage();

    expect(html).toContain("Product events");
    expect(html).toContain("Prediction submitted");
    expect(html).toContain("Session rate");
    expect(html).toContain("prediction_submit");
    expect(html).not.toContain("visitor_id");
    expect(html).not.toContain("session_id");
  });

  test("renders a truthful empty state when no product events exist", async () => {
    getAnalyticsDashboard.mockResolvedValue({
      ...dashboard,
      productEvents: { events: [], daily: [] },
    });

    const html = await renderPage();

    expect(html).toContain("No analytics events yet.");
    expect(html).not.toContain('data-chart="product"');
  });

  test("uses Arabic product-event labels without exposing identifiers", async () => {
    getRequestLocale.mockResolvedValue("ar");

    const html = await renderPage();

    expect(html).toContain("أحداث المنتج");
    expect(html).toContain("تم إرسال التوقع");
    expect(html).not.toContain("visitor_id");
    expect(html).not.toContain("session_id");
  });
});
