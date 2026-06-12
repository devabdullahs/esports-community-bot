import { describe, expect, test } from "vitest";
import { validateGameContent, GAME_TITLE_MAX_LENGTH, GAME_TEXT_MAX_LENGTH, GAME_FOCUS_MAX_ITEMS, GAME_FOCUS_ITEM_MAX_LENGTH } from "@/lib/game-validation";
import { validateMediaContent, MEDIA_NAME_MAX_LENGTH, MEDIA_TEXT_MAX_LENGTH, MEDIA_URL_MAX_LENGTH } from "@/lib/media-validation";

// ---------------------------------------------------------------------------
// validateGameContent
// ---------------------------------------------------------------------------

describe("validateGameContent — error codes", () => {
  const validBase = { title: { en: "Valorant", ar: "فالورانت" }, description: {}, status: {}, owner: {}, focus: [] };

  test("missing title → code 'title-required'", () => {
    const result = validateGameContent({ ...validBase, title: { en: "", ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("title-required");
  });

  test("title en only, missing ar → code 'title-required'", () => {
    const result = validateGameContent({ ...validBase, title: { en: "Valorant", ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("title-required");
  });

  test("title en too long → code 'title-too-long'", () => {
    const result = validateGameContent({ ...validBase, title: { en: "x".repeat(GAME_TITLE_MAX_LENGTH + 1), ar: "فالورانت" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("title-too-long");
  });

  test("title ar too long → code 'title-too-long'", () => {
    const result = validateGameContent({ ...validBase, title: { en: "Valorant", ar: "ع".repeat(GAME_TITLE_MAX_LENGTH + 1) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("title-too-long");
  });

  test("description en too long → code 'description-too-long'", () => {
    const result = validateGameContent({ ...validBase, description: { en: "x".repeat(GAME_TEXT_MAX_LENGTH + 1), ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("description-too-long");
  });

  test("status ar too long → code 'status-too-long'", () => {
    const result = validateGameContent({ ...validBase, status: { en: "", ar: "ع".repeat(GAME_TEXT_MAX_LENGTH + 1) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("status-too-long");
  });

  test("owner en too long → code 'owner-too-long'", () => {
    const result = validateGameContent({ ...validBase, owner: { en: "x".repeat(GAME_TEXT_MAX_LENGTH + 1), ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("owner-too-long");
  });

  test("too many focus items → code 'focus-too-many'", () => {
    const focus = Array.from({ length: GAME_FOCUS_MAX_ITEMS + 1 }, () => ({ en: "tag", ar: "وسم" }));
    const result = validateGameContent({ ...validBase, focus });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("focus-too-many");
  });

  test("focus item en too long → code 'focus-item-too-long'", () => {
    const result = validateGameContent({ ...validBase, focus: [{ en: "x".repeat(GAME_FOCUS_ITEM_MAX_LENGTH + 1), ar: "وسم" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("focus-item-too-long");
  });

  test("focus item ar too long → code 'focus-item-too-long'", () => {
    const result = validateGameContent({ ...validBase, focus: [{ en: "tag", ar: "ع".repeat(GAME_FOCUS_ITEM_MAX_LENGTH + 1) }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("focus-item-too-long");
  });

  test("valid game → ok: true, no code", () => {
    const result = validateGameContent(validBase);
    expect(result.ok).toBe(true);
  });

  test("English error text unchanged (API compatibility)", () => {
    const result = validateGameContent({ ...validBase, title: { en: "", ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Title is required in English and Arabic");
  });

  test("no discordChannelId → ok, value.discordChannelId null", () => {
    const result = validateGameContent(validBase);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.discordChannelId).toBeNull();
  });

  test("blank discordChannelId → ok, value.discordChannelId null", () => {
    const result = validateGameContent({ ...validBase, discordChannelId: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.discordChannelId).toBeNull();
  });

  test("valid snowflake discordChannelId → ok, trimmed value preserved", () => {
    const result = validateGameContent({ ...validBase, discordChannelId: " 123456789012345678 " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.discordChannelId).toBe("123456789012345678");
  });

  test("non-numeric discordChannelId → code 'news-channel-invalid'", () => {
    const result = validateGameContent({ ...validBase, discordChannelId: "not-a-snowflake" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("news-channel-invalid");
  });

  test("too-short discordChannelId → code 'news-channel-invalid'", () => {
    const result = validateGameContent({ ...validBase, discordChannelId: "12345" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("news-channel-invalid");
  });
});

// ---------------------------------------------------------------------------
// validateMediaContent
// ---------------------------------------------------------------------------

describe("validateMediaContent — error codes", () => {
  const validBase = {
    name: { en: "Echo MENA", ar: "إيكو مينا" },
    description: {},
    logoUrl: null,
    links: [],
  };

  test("missing name → code 'name-required'", () => {
    const result = validateMediaContent({ ...validBase, name: { en: "", ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("name-required");
  });

  test("name en only → code 'name-required'", () => {
    const result = validateMediaContent({ ...validBase, name: { en: "Echo MENA", ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("name-required");
  });

  test("name en too long → code 'name-too-long'", () => {
    const result = validateMediaContent({ ...validBase, name: { en: "x".repeat(MEDIA_NAME_MAX_LENGTH + 1), ar: "إيكو" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("name-too-long");
  });

  test("description ar too long → code 'description-too-long'", () => {
    const result = validateMediaContent({ ...validBase, description: { en: "", ar: "ع".repeat(MEDIA_TEXT_MAX_LENGTH + 1) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("description-too-long");
  });

  test("logo URL too long → code 'logo-url-too-long'", () => {
    const result = validateMediaContent({ ...validBase, logoUrl: "https://example.com/" + "x".repeat(MEDIA_URL_MAX_LENGTH) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("logo-url-too-long");
  });

  test("logo URL not http(s) → code 'logo-url-invalid'", () => {
    const result = validateMediaContent({ ...validBase, logoUrl: "notaurl" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("logo-url-invalid");
  });

  test("logo URL javascript: → code 'logo-url-invalid'", () => {
    const result = validateMediaContent({ ...validBase, logoUrl: "javascript:alert(1)" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("logo-url-invalid");
  });

  test("valid media → ok: true", () => {
    const result = validateMediaContent(validBase);
    expect(result.ok).toBe(true);
  });

  test("English error text unchanged (API compatibility)", () => {
    const result = validateMediaContent({ ...validBase, name: { en: "", ar: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Name is required in English and Arabic");
  });
});
