import { describe, expect, test } from "vitest";
import { buildCoStreamGroups } from "@/lib/co-streams";
import type { CoStreamChannel, StreamPlatform } from "@/lib/stream-types";

// ---------------------------------------------------------------------------
// buildCoStreamGroups — pure grouping + headline aggregation
// ---------------------------------------------------------------------------

let nextId = 1;

function channel(overrides: Partial<CoStreamChannel> = {}): CoStreamChannel {
  const platform: StreamPlatform = overrides.platform ?? "twitch";
  const handle = overrides.handle ?? `handle-${nextId++}`;
  return {
    id: overrides.id ?? nextId++,
    platform,
    handle,
    label: overrides.label ?? "Creator",
    scope: overrides.scope ?? "ewc",
    creatorKey: overrides.creatorKey ?? "creator",
    gameSlug: overrides.gameSlug ?? null,
    gameSlugs: overrides.gameSlugs ?? [],
    teamKey: overrides.teamKey ?? null,
    matchExternalId: overrides.matchExternalId ?? null,
    language: overrides.language ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    isDefault: overrides.isDefault ?? false,
    active: overrides.active ?? true,
    addedBy: overrides.addedBy ?? null,
    createdAt: overrides.createdAt ?? "2026-06-01 00:00:00",
    updatedAt: overrides.updatedAt ?? "2026-06-01 00:00:00",
    url: overrides.url ?? `https://example.com/${handle}`,
    isLive: overrides.isLive ?? false,
    liveTitle: overrides.liveTitle ?? null,
    viewerCount: overrides.viewerCount ?? null,
    startedAt: overrides.startedAt ?? null,
  };
}

describe("buildCoStreamGroups — grouping", () => {
  test("two channels with same creatorKey + scope collapse into one group", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "twitch", creatorKey: "alpha", scope: "ewc" }),
      channel({ platform: "kick", creatorKey: "alpha", scope: "ewc" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].channels).toHaveLength(2);
  });

  test("two different creators stay as two groups", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "twitch", creatorKey: "alpha", scope: "ewc" }),
      channel({ platform: "twitch", creatorKey: "beta", scope: "ewc" }),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("buildCoStreamGroups — embedChannel preference", () => {
  test("prefers a live default embeddable channel", () => {
    const liveDefault = channel({ platform: "twitch", handle: "live-default", isDefault: true, isLive: true });
    const groups = buildCoStreamGroups([
      channel({ platform: "kick", handle: "live-other", isLive: true }),
      liveDefault,
      channel({ platform: "twitch", handle: "offline-default", isDefault: true }),
    ]);
    expect(groups[0].embedChannel?.handle).toBe("live-default");
  });

  test("falls back to any live embeddable when no live default", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "twitch", handle: "offline-default", isDefault: true }),
      channel({ platform: "kick", handle: "live-other", isLive: true }),
    ]);
    expect(groups[0].embedChannel?.handle).toBe("live-other");
  });

  test("falls back to any default embeddable when nothing live", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "kick", handle: "non-default" }),
      channel({ platform: "twitch", handle: "the-default", isDefault: true }),
    ]);
    expect(groups[0].embedChannel?.handle).toBe("the-default");
  });

  test("falls back to any embeddable when no default and nothing live", () => {
    const groups = buildCoStreamGroups([channel({ platform: "kick", handle: "only-embeddable" })]);
    expect(groups[0].embedChannel?.handle).toBe("only-embeddable");
  });

  test("embedChannel is null when no embeddable platform present", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "youtube", handle: "yt" }),
      channel({ platform: "soop", handle: "soop" }),
    ]);
    expect(groups[0].embedChannel).toBeNull();
  });
});

describe("buildCoStreamGroups — headline aggregation regressions", () => {
  test("BUG 1: headline viewers = embed channel count, not the sum across platforms", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "twitch", handle: "tw", creatorKey: "alpha", isDefault: true, isLive: true, viewerCount: 1000 }),
      channel({ platform: "kick", handle: "kk", creatorKey: "alpha", isLive: true, viewerCount: 400 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].viewerCount).toBe(1000);
    expect(groups[0].viewerCount).not.toBe(1400);
  });

  test("BUG 2: startedAt is the numeric minimum, not lexicographic", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "twitch", handle: "tw", creatorKey: "alpha", isLive: true, startedAt: 1781970000 }),
      channel({ platform: "kick", handle: "kk", creatorKey: "alpha", isLive: true, startedAt: 1781967600 }),
    ]);
    expect(groups[0].startedAt).toBe(1781967600);
  });
});

describe("buildCoStreamGroups — group sort order", () => {
  test("live groups sort first, then by viewerCount desc", () => {
    const groups = buildCoStreamGroups([
      channel({ platform: "twitch", handle: "off", creatorKey: "offline", isLive: false }),
      channel({ platform: "twitch", handle: "low", creatorKey: "low-live", isDefault: true, isLive: true, viewerCount: 50 }),
      channel({ platform: "twitch", handle: "high", creatorKey: "high-live", isDefault: true, isLive: true, viewerCount: 900 }),
    ]);
    expect(groups.map((g) => g.creatorKey)).toEqual(["high-live", "low-live", "offline"]);
  });
});
