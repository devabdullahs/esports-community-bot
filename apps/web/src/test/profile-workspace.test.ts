import { describe, expect, it } from "vitest";
import { normalizeProfileTab, profileTabHref } from "@/lib/profile-workspace";

describe("profile workspace", () => {
  it("accepts known tabs and falls back to overview", () => {
    expect(normalizeProfileTab("notifications")).toBe("notifications");
    expect(normalizeProfileTab("unknown")).toBe("overview");
    expect(normalizeProfileTab(null)).toBe("overview");
  });

  it("preserves account filters when changing tabs", () => {
    expect(
      profileTabHref("/me", "guildId=123&season=2026&tab=overview", "predictions"),
    ).toBe("/me?guildId=123&season=2026&tab=predictions");
  });
});
