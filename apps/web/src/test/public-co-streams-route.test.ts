import { describe, expect, test, vi } from "vitest";
import type { PublicCoStream } from "@/lib/public-co-stream-types";

// The route is a pass-through, so the regression worth owning is that it passes through the
// PROJECTED value and adds nothing of its own. Mocking the loader keeps this a boundary test
// rather than a second copy of the projector's exact-shape assertions.
const projected: PublicCoStream = {
  id: "cs1_synthetic",
  label: "Synthetic Co-streamer",
  creatorKey: "synthetic-creator",
  gameSlugs: ["valorant"],
  language: "en",
  isLive: true,
  liveTitle: "Synthetic live title",
  liveGame: "Valorant",
  viewerCount: 12,
  startedAt: 1_780_000_000,
  channels: [
    {
      platform: "twitch",
      handle: "synthetic-handle",
      label: "Synthetic Co-streamer",
      scope: "ewc",
      gameSlugs: ["valorant"],
      language: "en",
      isDefault: true,
      isLive: true,
      liveTitle: "Synthetic live title",
      liveGame: "Valorant",
      viewerCount: 12,
      startedAt: 1_780_000_000,
      url: "https://twitch.tv/synthetic-handle",
      videoId: null,
    },
  ],
  embedChannel: null,
};

vi.mock("@/lib/public-co-streams", () => ({
  getAllPublicCoStreamsCached: vi.fn(async () => [projected]),
}));

const { GET } = await import("@/app/api/co-streams/route");

describe("GET /api/co-streams", () => {
  test("returns the projected public DTO unchanged", async () => {
    const body = await (await GET()).json();

    expect(body).toEqual({ streams: [projected] });
    // The route must not re-widen what the projector narrowed.
    expect(Object.keys(body.streams[0]).sort()).toEqual(Object.keys(projected).sort());
  });
});
