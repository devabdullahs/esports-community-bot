import { describe, expect, test } from "vitest";
import { coStreamApplies, selectDefaultCoStreams } from "@/lib/match-co-streams";

// Pure predicate only — no DB. The DB-backed liveCoStreamsByMatch is exercised
// by the bot-side channelsForTournament test; here we lock down the per-match
// applicability rules.

type Chan = Parameters<typeof coStreamApplies>[0];

function chan(overrides: Partial<Chan>): Chan {
  return {
    platform: "twitch",
    handle: "h",
    label: "L",
    url: null,
    scope: "game",
    teamKey: null,
    matchExternalId: null,
    ...overrides,
  };
}

const ctx = { matchExternalId: "Match:T-1", teamKeys: new Set(["teamvitality"]) };

describe("coStreamApplies", () => {
  test("game-scope applies to any match of the tournament", () => {
    expect(coStreamApplies(chan({ scope: "game" }), ctx)).toBe(true);
  });

  test("ewc-scope applies to any match", () => {
    expect(coStreamApplies(chan({ scope: "ewc" }), ctx)).toBe(true);
  });

  test("team-scope applies only when its team key is in the match", () => {
    expect(coStreamApplies(chan({ scope: "team", teamKey: "teamvitality" }), ctx)).toBe(true);
    expect(coStreamApplies(chan({ scope: "team", teamKey: "sentinels" }), ctx)).toBe(false);
    expect(coStreamApplies(chan({ scope: "team", teamKey: null }), ctx)).toBe(false);
  });

  test("match-scope applies only on the exact external id", () => {
    expect(coStreamApplies(chan({ scope: "match", matchExternalId: "Match:T-1" }), ctx)).toBe(true);
    expect(coStreamApplies(chan({ scope: "match", matchExternalId: "Match:T-2" }), ctx)).toBe(false);
    expect(coStreamApplies(chan({ scope: "match", matchExternalId: null }), ctx)).toBe(false);
  });

  test("match-scope with no match id in context does not apply", () => {
    expect(
      coStreamApplies(chan({ scope: "match", matchExternalId: "Match:T-1" }), {
        teamKeys: new Set<string>(),
      }),
    ).toBe(false);
  });
});

describe("selectDefaultCoStreams", () => {
  test("keeps the configured default platform once per co-streamer", () => {
    const selected = selectDefaultCoStreams([
      chan({ creatorKey: "brain", platform: "twitch", handle: "brain", label: "Brain", sortOrder: 1 }),
      chan({ creatorKey: "brain", platform: "kick", handle: "brain", label: "Brain", isDefault: true, sortOrder: 2 }),
      chan({ creatorKey: "ishark187", platform: "twitch", handle: "ishark187", label: "ishark187", isDefault: true }),
    ]);

    expect(selected.map((channel) => `${channel.creatorKey}:${channel.platform}`)).toEqual([
      "brain:kick",
      "ishark187:twitch",
    ]);
  });

  test("falls back to one deterministic platform when no default is configured", () => {
    const selected = selectDefaultCoStreams([
      chan({ creatorKey: "brain", platform: "kick", handle: "brain", label: "Brain", sortOrder: 3 }),
      chan({ creatorKey: "brain", platform: "twitch", handle: "brain", label: "Brain", sortOrder: 1 }),
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.platform).toBe("twitch");
  });
});
