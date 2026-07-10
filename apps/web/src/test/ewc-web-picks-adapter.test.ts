import { beforeEach, describe, expect, test } from "vitest";
import { submitWebSeasonPick, submitWebWeeklyPick } from "@/lib/ewc-prediction-writes";

const member = {
  authUserId: "auth-web-picker-adapter",
  discordUserId: "200000000000049001",
  displayName: "Member",
  avatarUrl: null,
  inGuild: true,
  isVerified: true,
};
const guildId = "920000000000009001";

beforeEach(async () => {
  const { upsertEwcProfileLink } = await import("@bot/db/ewcProfileLinks.js");
  const { upsertEwcSeason, upsertEwcWeek } = await import("@bot/db/ewcPredictions.js");
  await upsertEwcProfileLink({ authUserId: member.authUserId, discordUserId: member.discordUserId, guildId, season: "2026" });
  await upsertEwcSeason({ guildId, season: "2026", label: "Season", topSize: 3, openAt: 1, closeAt: 4_000_000_000, createdBy: "test" });
  await upsertEwcWeek({
    guildId,
    season: "2026",
    weekKey: "adapter-week",
    label: "Adapter week",
    openAt: Math.floor(Date.now() / 1000) - 60,
    closeAt: Math.floor(Date.now() / 1000) + 3_600,
    games: [{ key: "valorant", game: "Valorant", lockAt: Math.floor(Date.now() / 1000) + 1_800 }],
    createdBy: "test",
  });
});

describe("web prediction write adapter", () => {
  test("derives the linked single-guild identity and trusted timestamp for weekly writes", async () => {
    const calls: unknown[] = [];
    const roleSyncCalls: unknown[] = [];
    const result = await submitWebWeeklyPick({
      member,
      body: { weekKey: "adapter-week", gameKey: "valorant", pick: "Team Falcons" },
      submittedAt: 123,
      writer: {
        weekly: async (input) => { calls.push(input); return { ok: true, code: "saved", message: "saved", firstPick: true }; },
        seasonSlot: async () => ({ ok: false, code: "unexpected", message: "unexpected" }),
        seasonSwap: async () => ({ ok: false, code: "unexpected", message: "unexpected" }),
      },
      roleSync: async (input) => { roleSyncCalls.push(input); return {} as never; },
    });
    expect(result).toMatchObject({ ok: true, firstPick: true });
    expect(calls).toEqual([expect.objectContaining({ guildId, season: "2026", userId: member.discordUserId, submittedAt: 123 })]);
    expect(roleSyncCalls).toEqual([{ authUserId: member.authUserId, guildId, season: "2026" }]);
  });

  test("keeps a committed write successful when completion or role refresh fails", async () => {
    const result = await submitWebWeeklyPick({
      member,
      body: { weekKey: "adapter-week", gameKey: "valorant", pick: "Team Falcons" },
      submittedAt: 123,
      writer: {
        weekly: async () => ({ ok: true, code: "saved", message: "saved", firstPick: true }),
        seasonSlot: async () => ({ ok: false, code: "unexpected", message: "unexpected" }),
        seasonSwap: async () => ({ ok: false, code: "unexpected", message: "unexpected" }),
      },
      completionLoader: async () => { throw new Error("temporary read failure"); },
      roleSync: async () => { throw new Error("temporary Discord failure"); },
    });
    expect(result).toMatchObject({ ok: true, code: "saved", firstPick: true, completion: [] });
  });

  test("refuses missing profile state and malformed opaque keys without calling a writer", async () => {
    const calls: unknown[] = [];
    const writer = {
      weekly: async (input: unknown) => { calls.push(input); return { ok: true, code: "saved", message: "saved" }; },
      seasonSlot: async () => ({ ok: true, code: "saved", message: "saved" }),
      seasonSwap: async () => ({ ok: true, code: "saved", message: "saved" }),
    };
    const malformed = await submitWebWeeklyPick({ member, body: { weekKey: "../week", gameKey: "game", pick: "Falcons" }, submittedAt: 123, writer: writer as never });
    const missing = await submitWebSeasonPick({
      member: { ...member, authUserId: "missing-link", discordUserId: "200000000000049002" },
      body: { action: "set", index: 0, pick: "Falcons" },
      submittedAt: 123,
      writer: writer as never,
    });
    expect(malformed.code).toBe("invalid_input");
    expect(missing.code).toBe("profile_required");
    expect(calls).toEqual([]);
  });
});
