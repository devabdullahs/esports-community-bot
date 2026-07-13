import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPosts } = vi.hoisted(() => ({ listPosts: vi.fn() }));
vi.mock("@/lib/news", async () => {
  return { listPublishedNewsPostsForDiscoveryCached: listPosts };
});

import { newsRss } from "@/lib/news-feed";

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    gameSlug: "valorant",
    mediaSlug: null,
    contentMode: "translated",
    defaultLocale: "en",
    locale: "en",
    title: "English title",
    summary: "Summary",
    body: "Body",
    status: "published",
    authorDiscordId: null,
    authorName: null,
    coverImageUrl: null,
    coverPlacement: "top",
    ewc: true,
    translations: {
      en: { locale: "en", title: "English <title>", summary: "A & B", body: "Body" },
      ar: { locale: "ar", title: "عنوان", summary: "ملخص", body: "محتوى" },
    },
    authors: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    publishedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("localized RSS", () => {
  beforeEach(() => {
    process.env.EWC_DASHBOARD_PUBLIC_URL = "https://esportscommunity.net";
    listPosts.mockReset();
  });

  it("uses locale-canonical article URLs and escapes XML", async () => {
    listPosts.mockResolvedValue([post()]);
    const feed = await newsRss("en");
    expect(feed).toContain("https://esportscommunity.net/games/valorant/news/7");
    expect(feed).toContain("English &lt;title&gt;");
    expect(feed).toContain("A &amp; B");
    expect(feed).toContain('<guid isPermaLink="false">urn:esports-community:news:7:en</guid>');
    expect(feed).not.toContain("/ar/games/valorant/news/7");
  });

  it("keeps the item identifier stable when an article moves", async () => {
    listPosts.mockResolvedValue([post({ gameSlug: null, mediaSlug: "echo-mena" })]);
    const feed = await newsRss("en");
    expect(feed).toContain("https://esportscommunity.net/media/echo-mena/news/7");
    expect(feed).toContain('<guid isPermaLink="false">urn:esports-community:news:7:en</guid>');
  });

  it("omits an incomplete translation instead of advertising a broken locale", async () => {
    listPosts.mockResolvedValue([
      post({ translations: { en: { locale: "en", title: "English", summary: "", body: "Body" } } }),
    ]);
    expect(await newsRss("ar")).not.toContain("<item>");
  });

  it("treats database timestamps as UTC and strips XML-invalid controls", async () => {
    listPosts.mockResolvedValue([
      post({
        publishedAt: "2026-07-13 01:00:00",
        translations: {
          en: { locale: "en", title: "Safe\u0001 title", summary: "Summary", body: "Body" },
        },
      }),
    ]);
    const feed = await newsRss("en");
    expect(feed).toContain("Mon, 13 Jul 2026 01:00:00 GMT");
    expect(feed).toContain("Safe title");
    expect(feed).not.toContain("\u0001");
  });
});
