import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/ewc-profile-sync", () => ({ getEwcMePayload: vi.fn() }));
vi.mock("@bot/lib/ewcShareCard.js", () => ({ renderEwcShareCard: vi.fn() }));

import { getEwcMePayload } from "@/lib/ewc-profile-sync";
import { renderEwcShareCard } from "@bot/lib/ewcShareCard.js";
import {
  parseShareCardVariant,
  renderShareCardForViewer,
  ShareCardProfileRequiredError,
} from "@/lib/share-card";

const mockPayload = vi.mocked(getEwcMePayload);
const mockRenderer = vi.mocked(renderEwcShareCard);

beforeEach(() => {
  vi.clearAllMocks();
  mockPayload.mockResolvedValue({
    stats: {
      season: "2026",
      seasonPicks: ["Team Falcons", "Team Liquid"],
      weeksPredicted: 4,
      rank: 27,
      overallPoints: 181,
    },
  } as never);
  mockRenderer.mockResolvedValue(Buffer.from("png"));
});

describe("share-card adapter", () => {
  test("uses only the authenticated profile projection for the card", async () => {
    const result = await renderShareCardForViewer({
      authUserId: "auth-user",
      displayName: "  Current\u0000 Member  ",
      avatarUrl: null,
      variant: "prediction",
      locale: "ar",
    });

    expect(result.toString()).toBe("png");
    expect(mockPayload).toHaveBeenCalledWith({ authUserId: "auth-user" });
    expect(mockRenderer).toHaveBeenCalledWith({
      displayName: "Current Member",
      avatar: null,
      seasonPicks: ["Team Falcons", "Team Liquid"],
      weeklyCount: 4,
      season: "2026",
      locale: "ar",
    });
  });

  test("does not fetch an avatar outside the approved Discord hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await renderShareCardForViewer({
      authUserId: "auth-user",
      displayName: "Current Member",
      avatarUrl: "https://evil.example/avatar.png",
      variant: "prediction",
      locale: "en",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRenderer).toHaveBeenCalledWith(expect.objectContaining({ avatar: null }));
    vi.unstubAllGlobals();
  });

  test("accepts an approved avatar when its response has no content-length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "image/png" } })),
    );

    await renderShareCardForViewer({
      authUserId: "auth-user",
      displayName: "Current Member",
      avatarUrl: "https://cdn.discordapp.com/avatars/123/avatar.png",
      variant: "prediction",
      locale: "en",
    });

    expect(mockRenderer).toHaveBeenCalledWith(expect.objectContaining({ avatar: Buffer.from([1, 2, 3]) }));
    vi.unstubAllGlobals();
  });

  test("reports profile absence without rendering", async () => {
    mockPayload.mockResolvedValue({ stats: null } as never);

    await expect(
      renderShareCardForViewer({
        authUserId: "auth-user",
        displayName: "Current Member",
        avatarUrl: null,
        variant: "prediction",
        locale: "en",
      }),
    ).rejects.toBeInstanceOf(ShareCardProfileRequiredError);
    expect(mockRenderer).not.toHaveBeenCalled();
  });

  test("parses no other variant", () => {
    expect(parseShareCardVariant("prediction")).toBe("prediction");
    expect(parseShareCardVariant("leaderboard")).toBeNull();
    expect(parseShareCardVariant(null)).toBeNull();
  });
});
