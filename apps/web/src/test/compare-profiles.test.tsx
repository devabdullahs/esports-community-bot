import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { savePlayerLiquipedia, upsertPlayer } from "@bot/db/players.js";
import { saveTeamLiquipedia, upsertTeam } from "@bot/db/teams.js";
import {
  MAX_COMPARISON_SEARCH_RESULTS,
  getProfileComparison,
  parseComparisonId,
  parseComparisonSearchQuery,
  parseComparisonSelection,
  searchComparisonProfiles,
} from "@/lib/profile-comparison";

vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => "en",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

test("comparison projection exposes only stored public profile fields", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const alpha = await upsertTeam({
    game: "valorant",
    pandascore_id: 700_000 + Math.floor(Math.random() * 100_000),
    name: `Comparison Alpha ${suffix}`,
    acronym: "ALP",
    image_url: "https://img.example/comparison-alpha.png",
    raw_json: { private_token: "private-team-token", raw: "PRIVATE_RAW_TEAM_PAYLOAD" },
  });
  const bravo = await upsertTeam({
    game: "valorant",
    pandascore_id: 800_000 + Math.floor(Math.random() * 100_000),
    name: `Comparison Bravo ${suffix}`,
    acronym: "BRV",
    image_url: "https://img.example/comparison-bravo.png",
    raw_json: { private_token: "private-bravo-token" },
  });
  await saveTeamLiquipedia(alpha.id, {
    raw: "PRIVATE_LIQUIPEDIA_TEAM_PAYLOAD",
    facts: {
      region: "MENA",
      approx_total_winnings: "$$1,234",
      achievements: [{ title: "Comparison Cup" }],
      private_token: "private-facts-token",
    },
  });
  await saveTeamLiquipedia(bravo.id, {
    raw: "PRIVATE_LIQUIPEDIA_BRAVO_PAYLOAD",
    facts: {
      region: "Europe",
      achievements: [{ title: "Bravo Cup" }],
    },
  });
  const player = await upsertPlayer({
    game: "valorant",
    pandascore_id: 900_000 + Math.floor(Math.random() * 100_000),
    name: `Comparison Player ${suffix}`,
    role: "duelist",
    current_team_id: alpha.id,
    current_team_name: alpha.name,
    raw_json: { private_token: "private-player-token" },
  });
  await savePlayerLiquipedia(player.id, {
    raw: "PRIVATE_LIQUIPEDIA_PLAYER_PAYLOAD",
    facts: {
      approx_total_winnings: "$$567",
      achievements: [{ title: "Player Cup" }],
      private_token: "private-player-facts-token",
    },
  });

  const comparison = await getProfileComparison({
    kind: "team",
    leftId: alpha.id,
    rightId: bravo.id,
  });

  expect(comparison.left).toMatchObject({
    id: alpha.id,
    name: alpha.name,
    region: "MENA",
    approximateWinnings: "$1,234",
    achievements: ["Comparison Cup"],
    activeRoster: [expect.objectContaining({ id: player.id, name: player.name, role: "duelist" })],
  });
  expect(comparison.right).toMatchObject({ id: bravo.id, name: bravo.name, region: "Europe" });
  const payload = JSON.stringify(comparison);
  expect(payload).not.toContain("PRIVATE_");
  expect(payload).not.toContain("private-token");
  expect(comparison.left).not.toHaveProperty("raw_json");
  expect(comparison.left).not.toHaveProperty("liquipedia_raw");
  expect(comparison.left).not.toHaveProperty("liquipedia_facts");
  expect(comparison.left?.activeRoster[0]).not.toHaveProperty("raw_json");

  const Page = (await import("@/app/compare/page")).default;
  const html = renderToStaticMarkup(await Page({
    searchParams: Promise.resolve({ kind: "team", left: String(alpha.id), right: String(bravo.id) }),
  }));
  expect(html).toContain(alpha.name);
  expect(html).toContain(bravo.name);
  expect(html).toContain("Comparison Cup");
  expect(html).not.toContain("PRIVATE_");
}, 20_000);

test("comparison input parsing and public search are bounded", async () => {
  expect(parseComparisonId("9".repeat(11))).toBeNull();
  expect(parseComparisonId("-12")).toBeNull();
  expect(parseComparisonSearchQuery("x".repeat(81))).toBeNull();
  expect(parseComparisonSelection({ kind: "player", left: "44", right: "44" })).toEqual({
    kind: "player",
    leftId: 44,
    rightId: null,
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  for (let index = 0; index < MAX_COMPARISON_SEARCH_RESULTS + 2; index += 1) {
    await upsertTeam({
      game: "valorant",
      pandascore_id: 1_000_000 + index + Math.floor(Math.random() * 100_000),
      name: `Bounded Comparison ${suffix} ${index}`,
      raw_json: { private_token: `private-${index}` },
    });
  }
  const results = await searchComparisonProfiles("team", `Bounded Comparison ${suffix}`);
  expect(results).toHaveLength(MAX_COMPARISON_SEARCH_RESULTS);
  expect(JSON.stringify(results)).not.toContain("private-");
  const initialOptions = await searchComparisonProfiles("team", "");
  expect(initialOptions.length).toBeGreaterThan(0);
  expect(initialOptions.length).toBeLessThanOrEqual(MAX_COMPARISON_SEARCH_RESULTS);

  const { GET } = await import("@/app/api/compare/search/route");
  const oversizedResponse = await GET(new NextRequest(
    `http://localhost/api/compare/search?kind=team&q=${"x".repeat(81)}`,
  ));
  expect(oversizedResponse.status).toBe(400);
});

test("comparison page keeps invalid links in the empty state and canonicalizes valid selections", async () => {
  const ComparePage = await import("@/app/compare/page");
  const html = renderToStaticMarkup(await ComparePage.default({
    searchParams: Promise.resolve({ kind: "team", left: "not-an-id", right: "9".repeat(11) }),
  }));
  expect(html).toContain("Choose two profiles");

  const metadata = await ComparePage.generateMetadata({
    searchParams: Promise.resolve({ kind: "player", left: "12", right: "34" }),
  });
  expect(metadata.alternates?.canonical).toContain("/compare?kind=player&left=12&right=34");
  expect(metadata.robots).toEqual({ index: false, follow: true });
});
