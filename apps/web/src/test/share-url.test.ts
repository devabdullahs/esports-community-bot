import { describe, expect, it } from "vitest";
import { trackedShareUrl } from "@/lib/share-url";

describe("trackedShareUrl", () => {
  it("adds bounded attribution without changing the canonical input", () => {
    const canonical = "https://esportscommunity.net/games/valorant/news/42";
    const tracked = new URL(trackedShareUrl(canonical, "x", "article_launch"));
    expect(tracked.origin + tracked.pathname).toBe(canonical);
    expect(tracked.searchParams.get("utm_source")).toBe("x");
    expect(tracked.searchParams.get("utm_medium")).toBe("social");
    expect(tracked.searchParams.get("utm_campaign")).toBe("article_launch");
    expect(canonical).not.toContain("utm_");
  });

  it("rejects unbounded campaign values", () => {
    const tracked = new URL(
      trackedShareUrl("https://esportscommunity.net/news", "discord", "bad campaign?"),
    );
    expect(tracked.searchParams.get("utm_campaign")).toBe("news_share");
  });
});
