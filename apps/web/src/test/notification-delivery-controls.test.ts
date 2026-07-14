import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/follows", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/follows")>();
  return { ...original, getViewerDiscordId: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn().mockResolvedValue(null) }));

import { getViewerDiscordId } from "@/lib/follows";

const mockViewerDiscordId = vi.mocked(getViewerDiscordId);
const { PATCH: patchPrefs } = await import("@/app/api/me/notification-prefs/route");
const { PATCH: patchFollow } = await import("@/app/api/me/follows/route");

const VIEWER_ID = "200000000000079001";
const OTHER_ID = "200000000000079002";

function mutationRequest(path: string, body: unknown, origin = "http://localhost") {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin, host: "localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockViewerDiscordId.mockReset();
  mockViewerDiscordId.mockResolvedValue(VIEWER_ID);
});

describe("PATCH /api/me/notification-prefs", () => {
  test("requires a signed-in, same-origin viewer", async () => {
    mockViewerDiscordId.mockResolvedValue(null);
    expect((await patchPrefs(mutationRequest("/api/me/notification-prefs", { dmEnabled: true }))).status).toBe(401);
    mockViewerDiscordId.mockResolvedValue(VIEWER_ID);
    expect((await patchPrefs(mutationRequest("/api/me/notification-prefs", { dmEnabled: true }, "https://evil.example"))).status).toBe(403);
  });

  test.each([
    "{bad json",
    { dmEnabled: "yes" },
    { dmDeliveryMode: "weekly" },
    { timezone: "Not/A_Zone" },
    { digestMinute: 1440 },
    { quietStartMinute: 30 },
    { quietStartMinute: 30, quietEndMinute: null },
    { dmEnabled: true, unexpected: true },
  ])("rejects malformed or invalid input", async (body) => {
    expect((await patchPrefs(mutationRequest("/api/me/notification-prefs", body))).status).toBe(400);
  });

  test("rejects oversized JSON and preserves independent preference patches", async () => {
    expect((await patchPrefs(mutationRequest("/api/me/notification-prefs", { timezone: "x".repeat(5000) }))).status).toBe(400);
    const first = await patchPrefs(mutationRequest("/api/me/notification-prefs", { dmEnabled: false }));
    expect(first.status).toBe(200);
    const second = await patchPrefs(mutationRequest("/api/me/notification-prefs", {
      notifyMatchStart: false,
      dmDeliveryMode: "daily_digest",
      timezone: "Asia/Riyadh",
      quietStartMinute: 1380,
      quietEndMinute: 420,
      digestMinute: 1080,
    }));
    const body = await second.json();
    expect(body.prefs).toMatchObject({
      dm_enabled: 0,
      notify_match_start: 0,
      dm_delivery_mode: "daily_digest",
      timezone: "Asia/Riyadh",
      quiet_start_minute: 1380,
      quiet_end_minute: 420,
      digest_minute: 1080,
    });
  });
});

describe("PATCH /api/me/follows", () => {
  test("updates only the signed-in owner's nullable overrides", async () => {
    const { upsertFollow, listFollowsForUser } = await import("@bot/db/userFollows.js");
    const own = await upsertFollow({ discordUserId: VIEWER_ID, entityType: "team", entityKey: "Control Team" });
    const other = await upsertFollow({ discordUserId: OTHER_ID, entityType: "team", entityKey: "Other Team" });
    expect((await patchFollow(mutationRequest("/api/me/follows", { id: other.id, notifyMatchStart: "off" }))).status).toBe(404);
    expect((await patchFollow(mutationRequest("/api/me/follows", { id: own.id, notifyMatchStart: "on", notifyMatchResult: "off" }))).status).toBe(200);
    expect((await patchFollow(mutationRequest("/api/me/follows", { id: own.id, notifyMatchStart: "inherit" }))).status).toBe(200);
    const row = (await listFollowsForUser(VIEWER_ID)).find((follow: { id: number }) => follow.id === own.id);
    expect(row).toMatchObject({ notify_match_start: null, notify_match_result: 0 });
  });

  test.each([
    { id: "200000000000079001", notifyMatchStart: "on" },
    { id: 1, notifyMatchStart: "maybe" },
    { id: 1, discordUserId: OTHER_ID, notifyMatchStart: "on" },
    { id: 1 },
  ])("rejects invalid exact follow bodies", async (body) => {
    expect((await patchFollow(mutationRequest("/api/me/follows", body))).status).toBe(400);
  });
});
