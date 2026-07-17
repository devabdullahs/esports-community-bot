import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/community", () => ({
  clientIp: vi.fn(() => "test-ip"),
  requireVerifiedMember: vi.fn(),
  sameOriginOr403: vi.fn(() => null),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/match-reminders", () => ({
  cancelMatchReminder: vi.fn(),
  getMatchReminderTarget: vi.fn(),
  upsertMatchReminder: vi.fn(),
}));

import { DELETE, POST } from "@/app/api/me/match-reminders/route";
import { MatchReminderButton, runOptimisticReminderToggle } from "@/components/tournaments/match-reminder-button";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { cancelMatchReminder, getMatchReminderTarget, upsertMatchReminder } from "@/lib/match-reminders";
import { rateLimitOr429 } from "@/lib/rate-limit";

const member = {
  authUserId: "auth-reminder-user",
  discordUserId: "400000000000000001",
  displayName: "Reminder user",
  avatarUrl: null,
  inGuild: true,
  isVerified: true,
};

function request(method: "POST" | "DELETE", body: unknown) {
  return new Request("http://localhost/api/me/match-reminders", {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientIp).mockReturnValue("test-ip");
  vi.mocked(sameOriginOr403).mockReturnValue(null);
  vi.mocked(requireVerifiedMember).mockResolvedValue({ member });
  vi.mocked(rateLimitOr429).mockResolvedValue(null);
  vi.mocked(getMatchReminderTarget).mockResolvedValue({ id: 44, status: "scheduled" });
  vi.mocked(upsertMatchReminder).mockResolvedValue({
    discord_user_id: member.discordUserId,
    match_id: 44,
    created_at: "2026-07-17 12:00:00",
    canceled_at: null,
  });
  vi.mocked(cancelMatchReminder).mockResolvedValue(null);
});

describe("match reminder API", () => {
  test("rejects unauthenticated and cross-origin mutations before writing", async () => {
    vi.mocked(requireVerifiedMember).mockResolvedValueOnce({ response: new Response(null, { status: 401 }) } as never);
    expect((await POST(request("POST", { matchId: 44 }))).status).toBe(401);
    expect(getMatchReminderTarget).not.toHaveBeenCalled();

    vi.mocked(sameOriginOr403).mockReturnValueOnce(new Response(null, { status: 403 }) as never);
    expect((await POST(request("POST", { matchId: 44 }))).status).toBe(403);
    expect(requireVerifiedMember).toHaveBeenCalledTimes(1);
  });

  test.each([
    {},
    { matchId: 0 },
    { matchId: -1 },
    { matchId: 1.5 },
    { matchId: Number.MAX_SAFE_INTEGER + 1 },
    { matchId: "44" },
    { matchId: 44, discordUserId: "400000000000000099" },
  ])("rejects invalid or cross-user bodies: %o", async (body) => {
    const response = await POST(request("POST", body));
    expect(response.status).toBe(400);
    expect(getMatchReminderTarget).not.toHaveBeenCalled();
    expect(upsertMatchReminder).not.toHaveBeenCalled();
  });

  test("rejects missing and finished matches", async () => {
    vi.mocked(getMatchReminderTarget).mockResolvedValueOnce(null);
    expect((await POST(request("POST", { matchId: 44 }))).status).toBe(404);

    vi.mocked(getMatchReminderTarget).mockResolvedValueOnce({ id: 44, status: "finished" });
    expect((await POST(request("POST", { matchId: 44 }))).status).toBe(409);
    expect(upsertMatchReminder).not.toHaveBeenCalled();
  });

  test("uses the verified server-side member, checks user and IP limits, and keeps create idempotent", async () => {
    const first = await POST(request("POST", { matchId: 44 }));
    const duplicate = await POST(request("POST", { matchId: 44 }));

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(upsertMatchReminder).toHaveBeenCalledWith({ discordUserId: member.discordUserId, matchId: 44 });
    expect(rateLimitOr429).toHaveBeenCalledWith({ key: `match-reminder:${member.discordUserId}`, limit: 30, windowSec: 60 });
    expect(rateLimitOr429).toHaveBeenCalledWith({ key: "match-reminder-ip:test-ip", limit: 90, windowSec: 60 });
    await expect(first.json()).resolves.toEqual({ reminder: { matchId: 44, createdAt: "2026-07-17 12:00:00" } });
  });

  test("stops before the database when either the member or IP rate limit is exhausted", async () => {
    vi.mocked(rateLimitOr429).mockResolvedValueOnce(new Response(null, { status: 429 }) as never);
    expect((await POST(request("POST", { matchId: 44 }))).status).toBe(429);
    expect(getMatchReminderTarget).not.toHaveBeenCalled();

    vi.mocked(rateLimitOr429).mockResolvedValueOnce(null).mockResolvedValueOnce(new Response(null, { status: 429 }) as never);
    expect((await POST(request("POST", { matchId: 44 }))).status).toBe(429);
    expect(getMatchReminderTarget).not.toHaveBeenCalled();
  });

  test("cancels only the verified member's reminder and remains idempotent", async () => {
    const response = await DELETE(request("DELETE", { matchId: 44 }));
    expect(response.status).toBe(200);
    expect(cancelMatchReminder).toHaveBeenCalledWith({ discordUserId: member.discordUserId, matchId: 44 });
    await expect(response.json()).resolves.toEqual({ removed: false });
  });

  test("rejects cancellation for a missing match without touching another member's reminder", async () => {
    vi.mocked(getMatchReminderTarget).mockResolvedValueOnce(null);
    const response = await DELETE(request("DELETE", { matchId: 44 }));
    expect(response.status).toBe(404);
    expect(cancelMatchReminder).not.toHaveBeenCalled();
  });
});

describe("match reminder bell", () => {
  test("sends anonymous visitors to the localized login route with a safe callback", () => {
    const html = renderToStaticMarkup(
      <MatchReminderButton
        matchId={44}
        signedIn={false}
        initialReminded={false}
        locale="ar"
        callbackPath="/ar/tournaments/9"
      />,
    );
    expect(html).toContain('href="/ar/login?callbackURL=%2Far%2Ftournaments%2F9"');
    expect(html).toContain('aria-label="سجّل الدخول لضبط تذكير للمباراة"');
  });

  test("uses a localized pressed bell and rolls optimistic state back when its request fails", async () => {
    const html = renderToStaticMarkup(
      <MatchReminderButton
        matchId={44}
        signedIn
        initialReminded
        locale="en"
        callbackPath="/tournaments/9"
      />,
    );
    expect(html).toContain('aria-label="Cancel match reminder"');
    expect(html).toContain('aria-pressed="true"');

    const states: boolean[] = [];
    await expect(
      runOptimisticReminderToggle(true, (value) => states.push(value), async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    expect(states).toEqual([false, true]);
  });
});
