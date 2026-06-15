import { describe, expect, test } from "vitest";
import { validateNewsInput } from "@/lib/news-validation";

// A minimal payload that passes content validation (shared mode, English only).
const validBase = {
  gameSlug: "valorant",
  contentMode: "shared",
  defaultLocale: "en",
  status: "draft",
  translations: {
    en: { title: "Headline", summary: "", body: "Body" },
  },
};

describe("validateNewsInput — coverPlacement enum", () => {
  test("omitted coverPlacement → ok, defaults to 'top'", () => {
    const result = validateNewsInput({ ...validBase });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.coverPlacement).toBe("top");
  });

  test("null coverPlacement → ok, defaults to 'top'", () => {
    const result = validateNewsInput({ ...validBase, coverPlacement: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.coverPlacement).toBe("top");
  });

  test("'top' → ok, preserved", () => {
    const result = validateNewsInput({ ...validBase, coverPlacement: "top" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.coverPlacement).toBe("top");
  });

  test("'bottom' → ok, preserved", () => {
    const result = validateNewsInput({ ...validBase, coverPlacement: "bottom" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.coverPlacement).toBe("bottom");
  });

  test("'card-only' → ok, preserved", () => {
    const result = validateNewsInput({ ...validBase, coverPlacement: "card-only" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.coverPlacement).toBe("card-only");
  });

  test("unknown value → error", () => {
    const result = validateNewsInput({ ...validBase, coverPlacement: "middle" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/top, bottom, or card-only/);
  });

  test("non-string value → error", () => {
    const result = validateNewsInput({ ...validBase, coverPlacement: 3 });
    expect(result.ok).toBe(false);
  });
});

describe("validateNewsInput — owner (game vs media channel)", () => {
  const noOwner = {
    contentMode: "shared",
    defaultLocale: "en",
    status: "draft",
    translations: { en: { title: "Headline", summary: "", body: "Body" } },
  };

  test("a game post keeps gameSlug and has no mediaSlug", () => {
    const result = validateNewsInput({ ...validBase });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gameSlug).toBe("valorant");
      expect(result.value.mediaSlug).toBeNull();
    }
  });

  test("a media post sets mediaSlug and may omit the game", () => {
    const result = validateNewsInput({ ...noOwner, mediaSlug: "echo-mena" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mediaSlug).toBe("echo-mena");
      expect(result.value.gameSlug).toBeNull();
    }
  });

  test("a media post may carry an optional related game", () => {
    const result = validateNewsInput({ ...noOwner, mediaSlug: "echo-mena", gameSlug: "valorant" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mediaSlug).toBe("echo-mena");
      expect(result.value.gameSlug).toBe("valorant");
    }
  });

  test("no owner at all → error", () => {
    const result = validateNewsInput({ ...noOwner });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Game is required/);
  });
});
