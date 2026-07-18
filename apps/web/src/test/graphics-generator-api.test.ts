import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextResponse } from "next/server";
import { anonymous, gamesAdmin, mediaAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ recordAdminAudit: vi.fn() }));
vi.mock("@/lib/community", () => ({ sameOriginOr403: vi.fn(() => null) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/r2", () => ({ isManagedR2Url: vi.fn(() => false) }));
vi.mock("@/lib/graphics-generator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graphics-generator")>();
  return {
    ...actual,
    resolveGraphicsRenderRequest: vi.fn(),
    renderGraphics: vi.fn(),
  };
});

import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { renderGraphics, resolveGraphicsRenderRequest } from "@/lib/graphics-generator";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { isManagedR2Url } from "@/lib/r2";
import { POST } from "@/app/api/admin/graphics/route";

const mockAccess = vi.mocked(getAdminAccess);
const mockRender = vi.mocked(renderGraphics);
const mockResolve = vi.mocked(resolveGraphicsRenderRequest);
const mockRateLimit = vi.mocked(rateLimitOr429);
const mockAudit = vi.mocked(recordAdminAudit);
const mockManagedR2Url = vi.mocked(isManagedR2Url);

const canonicalMatch = {
  template: "match-result",
  owner: { kind: "game", slug: "valorant" },
  target: { id: 77, label: "Canonical final" },
  input: {
    template: "match-result",
    tournament: "Canonical final",
    game: "valorant",
    teamA: "Canonical Alpha",
    teamB: "Canonical Bravo",
    scoreA: 3,
    scoreB: 1,
  },
} as const;

function request(body: unknown) {
  return new Request("http://localhost/api/admin/graphics", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

describe("admin graphics render API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    mockResolve.mockResolvedValue(canonicalMatch as never);
    mockRender.mockResolvedValue(Buffer.from("png"));
    mockRateLimit.mockResolvedValue(null);
    mockManagedR2Url.mockReturnValue(false);
  });

  test("requires an authenticated admin", async () => {
    mockAccess.mockResolvedValue(anonymous());
    const response = await POST(request({ template: "match-result", resourceId: 77 }));
    expect(response.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  test("rejects an otherwise valid source outside the admin game scope", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["counterstrike"]));
    const response = await POST(request({ template: "match-result", resourceId: 77 }));
    expect(response.status).toBe(403);
    expect(mockRender).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledOnce();
  });

  test("rejects media branding outside the admin channel scope", async () => {
    const response = await POST(request({
      template: "match-result",
      resourceId: 77,
      brandMediaSlug: "outside-channel",
    }));
    expect(response.status).toBe(403);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  test("rejects custom branding for game-only admins", async () => {
    const response = await POST(request({
      template: "match-result",
      resourceId: 77,
      brandAssetUrl: "https://assets.example.test/graphics-branding/logo.png",
    }));
    expect(response.status).toBe(403);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  test("accepts only managed custom branding for media admins", async () => {
    mockAccess.mockResolvedValue(mediaAdmin(["alpha"]));
    mockManagedR2Url.mockReturnValue(true);
    mockResolve.mockResolvedValue({ ...canonicalMatch, owner: { kind: "media", slug: "alpha" } } as never);
    const response = await POST(request({
      template: "match-result",
      resourceId: 77,
      brandAssetUrl: "https://assets.example.test/graphics-branding/logo.png",
    }));
    expect(response.status).toBe(200);
    expect(mockManagedR2Url).toHaveBeenCalledWith(
      "https://assets.example.test/graphics-branding/logo.png",
      "graphics-branding/",
    );
    expect(mockAudit).toHaveBeenCalledWith(
      mediaAdmin(["alpha"]),
      "graphics.render",
      "match-result:77",
      expect.objectContaining({ customBrand: true }),
    );
  });

  test("renders canonical server data, audits it, and never caches the PNG", async () => {
    const response = await POST(request({
      template: "match-result",
      resourceId: 77,
      teamA: "Mallory United",
      teamB: "Spoofed Squad",
      scoreA: 99,
      scoreB: 0,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("graphics-match-result-77.png");
    expect(mockRender).toHaveBeenCalledWith(canonicalMatch);
    expect(mockAudit).toHaveBeenCalledWith(
      gamesAdmin(["valorant"]),
      "graphics.render",
      "match-result:77",
      { template: "match-result", ownerType: "game", ownerSlug: "valorant", brandMediaSlug: null, customBrand: false },
    );
  });

  test("enforces a per-admin render limit before canvas work", async () => {
    mockRateLimit.mockResolvedValueOnce(NextResponse.json({ error: "Too many" }, { status: 429 }));
    const response = await POST(request({ template: "match-result", resourceId: 77 }));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockRateLimit).toHaveBeenCalledWith({
      key: "admin:graphics:123456789012345679",
      limit: 60,
      windowSec: 600,
    });
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  test("rejects oversized bodies before parsing or rendering", async () => {
    const response = await POST(request({
      template: "match-result",
      resourceId: 77,
      padding: "x".repeat(5 * 1024),
    }));
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockRateLimit).toHaveBeenCalledOnce();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });
});
