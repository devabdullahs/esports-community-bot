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
const {
  GET: getPushSubscriptions,
  POST: createPushSubscription,
  DELETE: deletePushSubscription,
} = await import("@/app/api/me/push-subscriptions/route");

const VIEWER_ID = "200000000000079001";
const OTHER_ID = "200000000000079002";

function mutationRequest(path: string, body: unknown, origin = "http://localhost") {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin, host: "localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function pushRequest(method: "POST" | "DELETE", body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/me/push-subscriptions", {
    method,
    headers: { "content-type": "application/json", origin, host: "localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockViewerDiscordId.mockReset();
  mockViewerDiscordId.mockResolvedValue(VIEWER_ID);
  process.env.WEB_PUSH_ENABLED = "true";
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "BN-test-public-vapid-key";
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

describe("/api/me/push-subscriptions", () => {
  const subscription = {
    endpoint: "https://push.example.test/subscriptions/browser-one",
    expirationTime: null,
    keys: {
      p256dh: "BAnExampleP256dhKey_0123456789",
      auth: "ExampleAuthKey_0123456789",
    },
  };

  test("requires authentication and same-origin mutations", async () => {
    mockViewerDiscordId.mockResolvedValue(null);
    expect((await getPushSubscriptions()).status).toBe(401);
    expect((await createPushSubscription(pushRequest("POST", subscription))).status).toBe(401);
    mockViewerDiscordId.mockResolvedValue(VIEWER_ID);
    expect((await createPushSubscription(pushRequest("POST", subscription, "https://evil.example"))).status).toBe(403);
  });

  test("creates, lists without secrets, and revokes only the owner's subscription", async () => {
    const created = await createPushSubscription(pushRequest("POST", subscription));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.subscription.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(createdBody)).not.toContain(subscription.endpoint);
    expect(JSON.stringify(createdBody)).not.toContain(subscription.keys.p256dh);
    expect(JSON.stringify(createdBody)).not.toContain(subscription.keys.auth);

    const listed = await getPushSubscriptions();
    const listedBody = await listed.json();
    expect(listedBody.enabled).toBe(true);
    expect(listedBody.subscriptions).toHaveLength(1);
    expect(JSON.stringify(listedBody.subscriptions)).not.toContain(subscription.endpoint);

    mockViewerDiscordId.mockResolvedValue(OTHER_ID);
    expect((await deletePushSubscription(pushRequest("DELETE", {
      subscriptionId: createdBody.subscription.id,
    }))).status).toBe(404);

    mockViewerDiscordId.mockResolvedValue(VIEWER_ID);
    expect((await deletePushSubscription(pushRequest("DELETE", {
      subscriptionId: createdBody.subscription.id,
    }))).status).toBe(200);
  });

  test.each([
    "{bad json",
    { ...subscription, endpoint: "http://push.example.test/insecure" },
    { ...subscription, endpoint: "javascript:alert(1)" },
    { ...subscription, keys: { p256dh: "short", auth: "short" } },
    { ...subscription, extra: true },
  ])("rejects malformed or unsafe subscription input", async (body) => {
    expect((await createPushSubscription(pushRequest("POST", body))).status).toBe(400);
  });

  test("does not expose a public key while delivery is disabled", async () => {
    process.env.WEB_PUSH_ENABLED = "false";
    const response = await getPushSubscriptions();
    const body = await response.json();
    expect(body).toMatchObject({ enabled: false, publicKey: null });
    expect((await createPushSubscription(pushRequest("POST", subscription))).status).toBe(503);
  });
});
