import { describe, expect, test } from "vitest";
import { validateMediaContent } from "@/lib/media-validation";

const base = {
  name: { en: "Echo MENA", ar: "إيكو" },
  description: { en: "", ar: "" },
  links: [],
};

describe("validateMediaContent: discord channel + game", () => {
  test("accepts a valid Discord channel id (snowflake)", () => {
    const result = validateMediaContent({ ...base, discordChannelId: "123456789012345678" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.discordChannelId).toBe("123456789012345678");
  });

  test("rejects a non-snowflake Discord channel id", () => {
    const result = validateMediaContent({ ...base, discordChannelId: "not-an-id" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("discord-channel-invalid");
  });

  test("rejects a too-short Discord channel id", () => {
    const result = validateMediaContent({ ...base, discordChannelId: "12345" });
    expect(result.ok).toBe(false);
  });

  test("empty Discord channel id normalizes to null (opt-out)", () => {
    const result = validateMediaContent({ ...base, discordChannelId: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.discordChannelId).toBeNull();
  });

  test("normalizes the related game slug and defaults to null", () => {
    const tagged = validateMediaContent({ ...base, gameSlug: "Valorant" });
    expect(tagged.ok).toBe(true);
    if (tagged.ok) expect(tagged.value.gameSlug).toBe("valorant");

    const none = validateMediaContent({ ...base });
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.value.gameSlug).toBeNull();
  });
});
