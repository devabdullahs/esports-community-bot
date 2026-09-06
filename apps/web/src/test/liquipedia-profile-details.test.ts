import { beforeEach, expect, test, vi } from "vitest";
import type { PlayerProfile, TeamProfile } from "@/lib/pandascore-profiles";

const parse = vi.hoisted(() => vi.fn(() => ({
  achievements: [{ title: "Legacy trophy", image: null }],
  history: [{ period: "2020–2022", team: "Legacy club" }],
})));
vi.mock("@bot/services/liquipedia/entityParsers.js", () => ({ parsePlayerInfoboxDetails: parse }));
import { liquipediaPlayerDetails, liquipediaTeamDetails } from "@/lib/liquipedia-profile-details";

beforeEach(() => parse.mockClear());

test("structured player snapshots avoid HTML parsing, including known empty collections", () => {
  const profile = {
    liquipedia_raw: "<div>legacy content</div>",
    liquipedia_facts: JSON.stringify({ team: "Current club", achievements: [], history: [] }),
  } as PlayerProfile;
  expect(liquipediaPlayerDetails(profile)).toMatchObject({ team: "Current club", achievements: [], history: [] });
  expect(parse).not.toHaveBeenCalled();
});

test("team snapshots reuse structured history and achievements", () => {
  const profile = {
    liquipedia_raw: "<div>legacy content</div>",
    liquipedia_facts: JSON.stringify({ achievements: [{ title: "Champion" }], history: [{ period: "2025", team: "Current club" }] }),
  } as TeamProfile;
  expect(liquipediaTeamDetails(profile).achievements[0].title).toBe("Champion");
  expect(parse).not.toHaveBeenCalled();
});

test("legacy snapshots parse missing collections without replacing structured values", () => {
  const profile = {
    liquipedia_raw: "<div>legacy content</div>",
    liquipedia_facts: JSON.stringify({ achievements: [{ title: "Current trophy" }] }),
  } as PlayerProfile;
  expect(liquipediaPlayerDetails(profile)).toMatchObject({
    achievements: [{ title: "Current trophy" }],
    history: [{ team: "Legacy club" }],
  });
  expect(parse).toHaveBeenCalledOnce();
});

test("invalid facts still recover legacy HTML details", () => {
  const profile = { liquipedia_raw: "<div>legacy</div>", liquipedia_facts: "invalid json" } as PlayerProfile;
  expect(liquipediaPlayerDetails(profile).history[0].team).toBe("Legacy club");
  expect(parse).toHaveBeenCalledOnce();
});
