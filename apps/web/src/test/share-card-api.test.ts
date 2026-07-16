import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/community", () => ({ clientIp: vi.fn(() => "test-ip") }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/request-locale", () => ({ getRequestLocale: vi.fn(async () => "ar") }));
vi.mock("@/lib/session", () => ({ getOptionalSession: vi.fn() }));
vi.mock("@/lib/share-card", () => ({
  parseShareCardVariant: vi.fn((value: string | null) => (value === "prediction" ? value : null)),
  renderShareCardForViewer: vi.fn(),
  ShareCardProfileRequiredError: class ShareCardProfileRequiredError extends Error {},
}));

import { clientIp } from "@/lib/community";
import { getRequestLocale } from "@/lib/request-locale";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { renderShareCardForViewer } from "@/lib/share-card";
import { getOptionalSession } from "@/lib/session";
import { GET } from "@/app/api/me/share-card/route";

const mockSession = vi.mocked(getOptionalSession);
const mockLimit = vi.mocked(rateLimitOr429);
const mockRender = vi.mocked(renderShareCardForViewer);

function request(search = "variant=prediction") {
  return new Request(`http://localhost/api/me/share-card?${search}`, {
    headers: { "cf-connecting-ip": "203.0.113.8" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({
    user: {
      id: "auth-user",
      name: "Server Display",
      image: "https://cdn.discordapp.com/avatars/123/avatar.png",
    },
  } as never);
  mockLimit.mockResolvedValue(null);
  mockRender.mockResolvedValue(Buffer.from("png"));
});

describe("private share-card route", () => {
  test("requires a signed-in viewer", async () => {
    mockSession.mockResolvedValue(null);

    expect((await GET(request())).status).toBe(401);
    expect((await GET(request())).headers.get("cache-control")).toBe("private, no-store");
    expect(mockLimit).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  test("accepts only the fixed variant enum", async () => {
    expect((await GET(request("variant=leaderboard"))).status).toBe(400);
    expect((await GET(request("variant=prediction&variant=leaderboard"))).status).toBe(400);
    expect(mockLimit).not.toHaveBeenCalled();
  });

  test("uses server identity and ignores spoofed query fields", async () => {
    const response = await GET(
      request("variant=prediction&displayName=Mallory&avatarUrl=https%3A%2F%2Fevil.example%2Fa.png&rank=1&score=999999"),
    );

    expect(response.status).toBe(200);
    expect(mockRender).toHaveBeenCalledWith({
      authUserId: "auth-user",
      displayName: "Server Display",
      avatarUrl: "https://cdn.discordapp.com/avatars/123/avatar.png",
      variant: "prediction",
      locale: "ar",
    });
    expect(getRequestLocale).toHaveBeenCalledOnce();
  });

  test("enforces user and IP limits before rendering", async () => {
    mockLimit.mockResolvedValueOnce(NextResponse.json({ error: "Too many" }, { status: 429 }));

    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockLimit).toHaveBeenCalledWith({ key: "share-card:user:auth-user", limit: 10, windowSec: 60 });
    expect(clientIp).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  test("returns a private no-store PNG download", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("ewc-prediction-card.png");
    expect(await response.text()).toBe("png");
    expect(mockLimit).toHaveBeenNthCalledWith(1, { key: "share-card:user:auth-user", limit: 10, windowSec: 60 });
    expect(mockLimit).toHaveBeenNthCalledWith(2, { key: "share-card:ip:test-ip", limit: 30, windowSec: 60 });
  });
});
