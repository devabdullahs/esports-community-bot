import { describe, expect, test } from "vitest";
import {
  newsAvailableLocales,
  newsLanguagePaths,
  newsPublicPath,
} from "@/lib/news-url";
import { hasNonTrackingQuery, paginatedPath, parsePublicPage } from "@/lib/seo-query";
import { isIndexableMatch, isIndexablePlayer, isIndexableTeam } from "@/lib/seo-indexability";

const arabicShared = {
  id: 10,
  gameSlug: "valorant",
  mediaSlug: null,
  contentMode: "shared" as const,
  defaultLocale: "ar" as const,
  translations: { ar: { title: "خبر", body: "محتوى" } },
};

describe("SEO URL foundations", () => {
  test("keeps shared news in its one real language", () => {
    expect(newsAvailableLocales(arabicShared)).toEqual(["ar"]);
    expect(newsPublicPath(arabicShared, "en")).toBe("/ar/games/valorant/news/10");
    expect(newsLanguagePaths(arabicShared)).toEqual({
      ar: "/ar/games/valorant/news/10",
      "x-default": "/ar/games/valorant/news/10",
    });
  });

  test("advertises only complete translated variants", () => {
    const translated = {
      ...arabicShared,
      contentMode: "translated" as const,
      defaultLocale: "en" as const,
      translations: {
        en: { title: "News", body: "Body" },
        ar: { title: "", body: "" },
      },
    };
    expect(newsAvailableLocales(translated)).toEqual(["en"]);
  });

  test("normalizes pagination and separates tracking from content queries", () => {
    expect(parsePublicPage(undefined)).toBe(1);
    expect(parsePublicPage("2")).toBe(2);
    expect(parsePublicPage("2.5")).toBeNull();
    expect(parsePublicPage("10001")).toBeNull();
    expect(paginatedPath("/news", "ar", 3)).toBe("/ar/news?page=3");
    expect(hasNonTrackingQuery({ utm_source: "x" })).toBe(false);
    expect(hasNonTrackingQuery({ q: "falcons" })).toBe(true);
  });

  test("keeps thin entity stubs and placeholder matches out of search", () => {
    expect(isIndexableTeam({ name: "Stub" })).toBe(false);
    expect(isIndexableTeam({ name: "Falcons", location: "Saudi Arabia" })).toBe(true);
    expect(isIndexablePlayer({ name: "Player" })).toBe(false);
    expect(isIndexablePlayer({ name: "Player", current_team_name: "Falcons" })).toBe(true);
    expect(isIndexableMatch({
      scheduled_at: 1,
      team_a: "Falcons",
      team_b: "TBD",
      has_details: true,
    })).toBe(false);
  });
});
