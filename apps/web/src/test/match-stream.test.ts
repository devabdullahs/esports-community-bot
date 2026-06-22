import { describe, expect, test } from "vitest";
import { matchStream, type MatchRow } from "@/lib/tournaments";

// Defense-in-depth host check: even if a bad stream_url is somehow stored, the
// public projection only surfaces a liquipedia.net Special:Stream link.
function row(overrides: Partial<MatchRow>): MatchRow {
  return {
    id: 1,
    name: null,
    team_a: null,
    team_b: null,
    logo_a: null,
    logo_b: null,
    score_a: null,
    score_b: null,
    status: "running",
    scheduled_at: null,
    updated_at: null,
    ...overrides,
  } as MatchRow;
}

describe("matchStream", () => {
  test("accepts a liquipedia.net url", () => {
    expect(
      matchStream(
        row({
          stream_platform: "twitch",
          stream_url: "https://liquipedia.net/rocketleague/Special:Stream/twitch/RedirectEsports",
        }),
      ),
    ).toEqual({
      platform: "twitch",
      url: "https://liquipedia.net/rocketleague/Special:Stream/twitch/RedirectEsports",
    });
  });

  test("rejects an off-host url", () => {
    expect(
      matchStream(
        row({ stream_platform: "twitch", stream_url: "https://attacker.example/Special:Stream/twitch/x" }),
      ),
    ).toBeNull();
  });

  test("rejects a non-http url", () => {
    expect(matchStream(row({ stream_platform: "twitch", stream_url: "javascript:alert(1)" }))).toBeNull();
  });

  test("null when no url", () => {
    expect(matchStream(row({ stream_platform: "twitch", stream_url: null }))).toBeNull();
  });
});
