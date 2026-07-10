import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/follows", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/follows")>();
  return {
    ...original,
    getViewerDiscordId: vi.fn(),
  };
});

import { getViewerDiscordId } from "@/lib/follows";

const mockViewerDiscordId = vi.mocked(getViewerDiscordId);
const { GET } = await import("@/app/api/me/notifications/route");

const VIEWER_ID = "200000000000078001";
const OTHER_ID = "200000000000078002";
let viewerRows: Array<{ id: number; discord_user_id: string; title: string }> = [];

beforeAll(async () => {
  const {
    enqueueNotifications,
    listNotificationsForUser,
    markNotificationRead,
    upsertNotificationPrefs,
  } = await import("@bot/db/userNotifications.js");

  await upsertNotificationPrefs(VIEWER_ID, { dmEnabled: false });
  await upsertNotificationPrefs(OTHER_ID, { dmEnabled: false });
  for (let index = 1; index <= 7; index += 1) {
    await enqueueNotifications({
      userIds: [VIEWER_ID],
      type: "match_start",
      matchId: index,
      title: `Viewer notification ${index}`,
      dedupeKey: `notifications-api:viewer:${index}`,
    });
  }
  await enqueueNotifications({
    userIds: [OTHER_ID],
    type: "match_result",
    matchId: 99,
    title: "Other user's notification",
    dedupeKey: "notifications-api:other:1",
  });

  viewerRows = await listNotificationsForUser(VIEWER_ID, { limit: 100 });
  await markNotificationRead(VIEWER_ID, viewerRows[2].id);
});

beforeEach(() => {
  mockViewerDiscordId.mockReset();
  mockViewerDiscordId.mockResolvedValue(VIEWER_ID);
});

describe("GET /api/me/notifications", () => {
  test.each([
    "limit=0",
    "limit=-1",
    "limit=1.5",
    "limit=NaN",
    "limit=Infinity",
    "limit=101",
    "limit=",
    "offset=-1",
    "offset=1.5",
    "offset=NaN",
    "offset=Infinity",
    "offset=",
  ])("rejects invalid pagination: %s", async (query) => {
    const response = await GET(new Request(`http://localhost/api/me/notifications?${query}`));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid notification page." });
  });

  test("returns the first page, unread total, and next offset", async () => {
    const response = await GET(new Request("http://localhost/api/me/notifications?limit=3&offset=0"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notifications.map((row: { id: number }) => row.id)).toEqual(
      viewerRows.slice(0, 3).map((row) => row.id),
    );
    expect(body.unread).toBe(6);
    expect(body.nextOffset).toBe(3);
  });

  test("returns a middle page with a continuing offset", async () => {
    const response = await GET(new Request("http://localhost/api/me/notifications?limit=3&offset=3"));
    const body = await response.json();
    expect(body.notifications.map((row: { id: number }) => row.id)).toEqual(
      viewerRows.slice(3, 6).map((row) => row.id),
    );
    expect(body.unread).toBe(6);
    expect(body.nextOffset).toBe(6);
  });

  test("returns a final page with a null offset", async () => {
    const response = await GET(new Request("http://localhost/api/me/notifications?limit=3&offset=6"));
    const body = await response.json();
    expect(body.notifications.map((row: { id: number }) => row.id)).toEqual(
      viewerRows.slice(6).map((row) => row.id),
    );
    expect(body.nextOffset).toBeNull();
  });

  test("rejects unauthorized requests", async () => {
    mockViewerDiscordId.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/me/notifications"));
    expect(response.status).toBe(401);
  });

  test("never returns another user's rows", async () => {
    const response = await GET(new Request("http://localhost/api/me/notifications?limit=100"));
    const body = await response.json();
    expect(body.notifications).toHaveLength(7);
    expect(body.notifications.every((row: { discord_user_id: string }) => row.discord_user_id === VIEWER_ID)).toBe(true);
    expect(body.notifications.some((row: { title: string }) => row.title === "Other user's notification")).toBe(false);
  });
});
