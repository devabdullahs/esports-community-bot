import { describe, expect, test } from "vitest";
import { normalizeCreatorKey, normalizeGameSlug, normalizeGameSlugs } from "@/lib/stream-normalize";

describe("normalizeCreatorKey", () => {
  test("slugifies, lowercases, and trims punctuation", () => {
    expect(normalizeCreatorKey("OW Brain!!")).toBe("ow-brain");
  });

  test("non-string input becomes empty", () => {
    expect(normalizeCreatorKey(null)).toBe("");
    expect(normalizeCreatorKey(undefined)).toBe("");
  });
});

describe("normalizeGameSlug", () => {
  test("strips non-alphanumerics and lowercases", () => {
    expect(normalizeGameSlug("Rocket-League")).toBe("rocketleague");
  });
});

describe("normalizeGameSlugs", () => {
  test("splits on commas, Arabic commas, and dedupes", () => {
    expect(normalizeGameSlugs("overwatch, rocket-league، valorant")).toEqual([
      "overwatch",
      "rocketleague",
      "valorant",
    ]);
  });

  test("accepts an array and dedupes", () => {
    expect(normalizeGameSlugs(["Valorant", "valorant", "tft"])).toEqual(["valorant", "tft"]);
  });
});
