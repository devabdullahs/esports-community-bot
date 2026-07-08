import { beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("@bot/services/liquipedia.js", () => ({
  fetchEwcClubs: async () => ({
    sourceUrl: "https://liquipedia.net/esports/Esports_World_Cup/2026/Clubs",
    clubs: [
      {
        name: "Team Falcons",
        pageUrl: "https://liquipedia.net/esports/Team_Falcons",
        logo: "https://assets.esportscommunity.net/falcons.png",
        clubSupportProgram: true,
        games: [
          {
            label: "Dota 2",
            shortLabel: "Dota2",
            pageUrl: "https://liquipedia.net/dota2/Esports_World_Cup/2026",
            status: "qualified",
          },
        ],
      },
    ],
  }),
  fetchEwcClubStandings: async () => ({
    sourceUrl: "https://liquipedia.net/esports/Esports_World_Cup/2026/Club_Championship_Standings",
    standings: [{ rank: 1, team: "Team Falcons", points: 100 }],
  }),
}));

let publicMcpPOST: (request: Request) => Promise<Response>;
let tournamentId = 0;

const DEFAULT_GUILD = "123456789012345678";

beforeAll(async () => {
  process.env.EWC_PUBLIC_MCP_ENABLED = "true";
  process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = "100";
  process.env.EWC_PUBLIC_MCP_ALLOWED_ORIGINS = "http://localhost";
  process.env.EWC_DASHBOARD_PUBLIC_URL = "http://localhost";
  process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = DEFAULT_GUILD;

  const { createEwcNewsPost } = await import("@bot/db/ewcNewsPosts.js");
  await createEwcNewsPost({
    gameSlug: "valorant",
    contentMode: "shared",
    defaultLocale: "en",
    translations: {
      en: { title: "Published MCP story", summary: "Visible summary", body: "Visible public body" },
    },
    status: "published",
    ewc: true,
  });
  await createEwcNewsPost({
    gameSlug: "valorant",
    contentMode: "shared",
    defaultLocale: "en",
    translations: {
      en: { title: "Draft MCP story", summary: "Hidden summary", body: "Hidden draft body" },
    },
    status: "draft",
  });

  const { upsertTeam, saveTeamLiquipedia } = await import("@bot/db/teams.js");
  const team = await upsertTeam({
    game: "valorant",
    pandascore_id: 91001,
    name: "Raw Test Team",
    slug: "raw-test-team",
    image_url: "https://assets.esportscommunity.net/team.png",
    raw_json: { privateFixture: true },
  });
  await saveTeamLiquipedia(team.id, {
    url: "https://liquipedia.net/valorant/Raw_Test_Team",
    raw: "<table>raw profile</table>",
    facts: { secretFixture: true },
  });

  const { upsertPlayer, savePlayerLiquipedia } = await import("@bot/db/players.js");
  const player = await upsertPlayer({
    game: "valorant",
    pandascore_id: 92001,
    name: "Raw Test Player",
    slug: "raw-test-player",
    image_url: "https://assets.esportscommunity.net/player.png",
    current_team_id: team.id,
    current_team_name: team.name,
    raw_json: { privateFixture: true },
  });
  await savePlayerLiquipedia(player.id, {
    url: "https://liquipedia.net/valorant/Raw_Test_Player",
    raw: "<table>raw player</table>",
    facts: { secretFixture: true },
  });

  const { addTournament } = await import("@bot/db/tournaments.js");
  const tournament = await addTournament({
    source: "liquipedia",
    external_id: "public-mcp-tournament",
    game: "valorant",
    name: "Public MCP Event",
    url: "https://liquipedia.net/valorant/Public_MCP_Event",
    guild_id: DEFAULT_GUILD,
    added_by: "test",
  });
  tournamentId = tournament.id;

  const { upsertMatch } = await import("@bot/db/matches.js");
  await upsertMatch({
    tournament_id: tournamentId,
    source: "liquipedia",
    external_id: "public-mcp-match",
    name: "Raw Test Team vs Other Team",
    team_a: "Raw Test Team",
    team_b: "Other Team",
    score_a: 1,
    score_b: 0,
    status: "running",
    scheduled_at: Math.floor(Date.now() / 1000),
  });

  ({ POST: publicMcpPOST } = await import("@/app/api/public-mcp/route"));
});

function publicMcpRequest(
  body: unknown,
  {
    origin = "http://localhost",
    ip = "203.0.113.10",
    forwardedFor,
    realIp,
    authorization,
  }: {
    origin?: string | null;
    ip?: string | null;
    forwardedFor?: string;
    realIp?: string;
    authorization?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Host: "localhost",
  };
  if (ip) headers["cf-connecting-ip"] = ip;
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  if (realIp) headers["x-real-ip"] = realIp;
  if (origin) headers.Origin = origin;
  if (authorization) headers.Authorization = authorization;
  return new Request("http://localhost/api/public-mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function parseMcpResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const data = text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    return data ? JSON.parse(data) : { raw: text };
  }
}

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

describe("/api/public-mcp access", () => {
  test("lists tools without Authorization", async () => {
    const response = await publicMcpPOST(publicMcpRequest(toolsList));
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_site_overview",
        "search_news",
        "get_tournament_status",
        "get_ewc_club_summary",
        "list_co_streams",
        "search_teams",
        "search_players",
        "get_public_ewc_leaderboard",
      ]),
    );
  });

  test("ignores invalid bearer headers on the public endpoint", async () => {
    const response = await publicMcpPOST(
      publicMcpRequest(toolCall("get_site_overview"), {
        authorization: "Bearer definitely-not-an-admin-key",
        ip: "203.0.113.11",
      }),
    );
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.structuredContent).toMatchObject({
      games: expect.any(Number),
      liveMatches: expect.any(Number),
      publishedNews: expect.any(Number),
    });
  });

  test("rejects JSON-RPC batch arrays", async () => {
    const response = await publicMcpPOST(
      publicMcpRequest([toolCall("get_site_overview")], { ip: "203.0.113.12" }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/batch/i),
    });
  });

  test("returns 404 when disabled", async () => {
    process.env.EWC_PUBLIC_MCP_ENABLED = "false";
    const response = await publicMcpPOST(
      publicMcpRequest(toolCall("get_site_overview"), { ip: "203.0.113.13" }),
    );
    process.env.EWC_PUBLIC_MCP_ENABLED = "true";
    expect(response.status).toBe(404);
  });

  test("rejects disallowed browser origins", async () => {
    const response = await publicMcpPOST(
      publicMcpRequest(toolCall("get_site_overview"), {
        origin: "https://evil.example",
        ip: "203.0.113.14",
      }),
    );
    expect(response.status).toBe(403);
  });

  test("rate limits by client IP", async () => {
    process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = "1";
    const ip = "203.0.113.55";
    expect((await publicMcpPOST(publicMcpRequest(toolsList, { ip }))).status).toBe(200);
    const response = await publicMcpPOST(publicMcpRequest(toolsList, { ip }));
    process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = "100";
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  test("does not trust spoofed forwarding headers for rate-limit buckets", async () => {
    const previousLimit = process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE;
    process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = "1";
    try {
      const nonce = `${Date.now()}-${Math.random()}`;
      const first = await publicMcpPOST(
        publicMcpRequest(toolsList, {
          ip: null,
          forwardedFor: `198.51.100.10-${nonce}`,
          realIp: `198.51.100.20-${nonce}`,
        }),
      );
      const response = await publicMcpPOST(
        publicMcpRequest(toolsList, {
          ip: null,
          forwardedFor: `198.51.100.11-${nonce}`,
          realIp: `198.51.100.21-${nonce}`,
        }),
      );
      expect(first.status).toBe(200);
      expect(response.status).toBe(429);
    } finally {
      process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = previousLimit;
    }
  });
});

describe("/api/public-mcp tools", () => {
  test.each([
    ["get_site_overview", () => ({})],
    ["list_games", () => ({ locale: "en" })],
    ["search_news", () => ({ query: "Published MCP", limit: 5 })],
    ["get_tournament_status", () => ({ tournamentId })],
    ["list_tournaments", () => ({ gameSlug: "valorant", limit: 5 })],
    ["get_ewc_club_summary", () => ({ query: "Falcons", scope: "all", limit: 5 })],
    ["list_co_streams", () => ({ limit: 5 })],
    ["search_teams", () => ({ query: "Raw Test", limit: 5 })],
    ["search_players", () => ({ query: "Raw Test", limit: 5 })],
    ["get_public_ewc_leaderboard", () => ({ guildId: DEFAULT_GUILD, season: "2026", limit: 5 })],
  ])("%s returns structured content", async (name, argsForTool) => {
    const response = await publicMcpPOST(
      publicMcpRequest(toolCall(name, argsForTool()), { ip: `203.0.113.${Math.floor(Math.random() * 80) + 100}` }),
    );
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent).toBeTruthy();
  });

  test("search_news never returns drafts", async () => {
    const response = await publicMcpPOST(
      publicMcpRequest(toolCall("search_news", { query: "MCP story", limit: 10 }), {
        ip: "203.0.113.20",
      }),
    );
    const body = await parseMcpResponse(response);
    const titles = body.result.structuredContent.posts.map((post: { title: string }) => post.title);
    expect(titles).toContain("Published MCP story");
    expect(titles).not.toContain("Draft MCP story");
  });

  test("team and player searches do not expose raw enrichment payloads", async () => {
    const teamsResponse = await publicMcpPOST(
      publicMcpRequest(toolCall("search_teams", { query: "Raw Test", limit: 5 }), {
        ip: "203.0.113.21",
      }),
    );
    const playersResponse = await publicMcpPOST(
      publicMcpRequest(toolCall("search_players", { query: "Raw Test", limit: 5 }), {
        ip: "203.0.113.22",
      }),
    );

    const teams = await parseMcpResponse(teamsResponse);
    const players = await parseMcpResponse(playersResponse);
    const teamText = JSON.stringify(teams.result.structuredContent);
    const playerText = JSON.stringify(players.result.structuredContent);

    expect(teamText).toContain("Raw Test Team");
    expect(playerText).toContain("Raw Test Player");
    expect(teamText).not.toMatch(/liquipedia_raw|liquipedia_facts|raw profile|secretFixture|privateFixture/);
    expect(playerText).not.toMatch(/liquipedia_raw|liquipedia_facts|raw player|secretFixture|privateFixture/);
  });
});
