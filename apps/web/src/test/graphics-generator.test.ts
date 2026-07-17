import { expect, test } from "vitest";
import { get, run } from "@bot/db/client.js";
import {
  filterGraphicsGeneratorData,
  renderGraphics,
  resolveGraphicsRenderRequest,
} from "@/lib/graphics-generator";
import {
  graphicsOptionsForTemplate,
  parseGraphicsRenderRequest,
  type GraphicsGeneratorData,
} from "@/lib/graphics-generator-model";
import { gamesAdmin, mediaAdmin } from "./access";

process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = "graphics-generator-test-guild";

async function seedGraphicsTournament(game: string, suffix: string) {
  const guildId = process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID!;
  const externalId = `graphics-${game}-${suffix}`;
  await run(
    `INSERT INTO tournaments (source, external_id, game, name, url, guild_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ["liquipedia", externalId, game, `${game} finals ${suffix}`, `https://example.test/${externalId}`, guildId],
  );
  const tournament = await get("SELECT id FROM tournaments WHERE source = $1 AND external_id = $2", ["liquipedia", externalId]) as { id: number };
  return tournament.id;
}

async function seedMatch(tournamentId: number, suffix: string) {
  await run(
    `INSERT INTO matches
       (tournament_id, source, external_id, name, team_a, team_b, logo_a, logo_b, score_a, score_b, status, scheduled_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      tournamentId,
      "liquipedia",
      `match-${suffix}`,
      `Canonical match ${suffix}`,
      "Canonical Alpha",
      "Canonical Bravo",
      "https://example.test/alpha.png",
      "https://example.test/bravo.png",
      3,
      1,
      "finished",
      1_750_000_000,
      "2026-07-17 00:00:00",
    ],
  );
  return (await get("SELECT id FROM matches WHERE source = $1 AND external_id = $2", ["liquipedia", `match-${suffix}`])) as { id: number };
}

test("server resolution ignores spoofed match names and scores", async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const tournamentId = await seedGraphicsTournament("graphics-valorant", suffix);
  const match = await seedMatch(tournamentId, suffix);

  const parsed = parseGraphicsRenderRequest({
    template: "match-result",
    resourceId: match.id,
    teamA: "Mallory United",
    teamB: "Spoofed Squad",
    scoreA: 99,
    scoreB: 0,
  });
  expect(parsed).toMatchObject({
    template: "match-result",
    resourceId: match.id,
    format: "16:9",
    style: "ewc-teal",
    scale: 2,
  });

  const resolved = await resolveGraphicsRenderRequest(parsed!);
  expect(resolved).toMatchObject({
    template: "match-result",
    owner: { kind: "game", slug: "graphics-valorant" },
    input: {
      teamA: "Canonical Alpha",
      teamB: "Canonical Bravo",
      logoA: "https://example.test/alpha.png",
      logoB: "https://example.test/bravo.png",
      scoreA: 3,
      scoreB: 1,
    },
  });

  const image = await renderGraphics(resolved!);
  expect(image.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
});

test("template selection exposes only its corresponding source type", () => {
  const data: GraphicsGeneratorData = {
    matches: [{ id: 1, label: "Match", detail: "valorant", owner: { kind: "game", slug: "valorant" } }],
    standings: [{ id: 2, label: "Standings", detail: "valorant", owner: { kind: "game", slug: "valorant" } }],
    news: [{ id: 3, label: "News", detail: "channel", owner: { kind: "media", slug: "channel" } }],
  };

  expect(graphicsOptionsForTemplate(data, "match-result").map((option) => option.id)).toEqual([1]);
  expect(graphicsOptionsForTemplate(data, "standings").map((option) => option.id)).toEqual([2]);
  expect(graphicsOptionsForTemplate(data, "news-promo").map((option) => option.id)).toEqual([3]);
});

test("scoped admins only receive graphics sources they manage", () => {
  const data: GraphicsGeneratorData = {
    matches: [
      { id: 1, label: "Valorant", detail: "valorant", owner: { kind: "game", slug: "valorant" } },
      { id: 2, label: "Counter-Strike", detail: "counterstrike", owner: { kind: "game", slug: "counterstrike" } },
    ],
    standings: [
      { id: 3, label: "Valorant standings", detail: "valorant", owner: { kind: "game", slug: "valorant" } },
    ],
    news: [
      { id: 4, label: "Channel post", detail: "alpha", owner: { kind: "media", slug: "alpha" } },
    ],
  };

  const gameScoped = filterGraphicsGeneratorData(gamesAdmin(["valorant"]), data);
  expect(gameScoped.matches.map((option) => option.id)).toEqual([1]);
  expect(gameScoped.standings.map((option) => option.id)).toEqual([3]);
  expect(gameScoped.news).toEqual([]);

  const mediaScoped = filterGraphicsGeneratorData(mediaAdmin(["alpha"]), data);
  expect(mediaScoped.matches).toEqual([]);
  expect(mediaScoped.standings).toEqual([]);
  expect(mediaScoped.news.map((option) => option.id)).toEqual([4]);
});

test("request parser accepts only the finite template ids and positive numeric resource ids", () => {
  expect(parseGraphicsRenderRequest({ template: "custom", resourceId: 1 })).toBeNull();
  expect(parseGraphicsRenderRequest({ template: "news-promo", resourceId: "1" })).toBeNull();
  expect(parseGraphicsRenderRequest({ template: "standings", resourceId: 0 })).toBeNull();
  expect(parseGraphicsRenderRequest({ template: "standings", resourceId: 1, format: "3:2" })).toBeNull();
  expect(parseGraphicsRenderRequest({ template: "standings", resourceId: 1, scale: 4 })).toBeNull();
  expect(parseGraphicsRenderRequest({ template: "news-promo", resourceId: 1, brandX: -1 })).toBeNull();
  expect(parseGraphicsRenderRequest({
    template: "news-promo",
    resourceId: 1,
    format: "9:16",
    language: "ar",
    alignment: "right",
    style: "carbon",
    scale: 3,
    brandPlacement: "custom",
    brandX: 42.25,
    brandY: 63.75,
    brandSize: 16.25,
  })).toMatchObject({
    format: "9:16",
    language: "ar",
    alignment: "right",
    style: "carbon",
    scale: 3,
    brandPlacement: "custom",
    brandX: 42.3,
    brandY: 63.8,
    brandSize: 16.3,
  });
});
