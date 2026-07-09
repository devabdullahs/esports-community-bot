import { beforeAll, describe, expect, test } from "vitest";
import {
  NEWS_BODY_MAX_LENGTH,
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
} from "@/lib/news-validation";

let mcpPOST: (request: Request) => Promise<Response>;

const SUPER_ID = "123456789012345678";
const SCOPED_ID = "223456789012345678";
const GAME_ALLOWED = "valorant";
const GAME_OUTSIDE_SCOPE = "rocket-league";
const MEDIA_ALLOWED = "echo-mena";

beforeAll(async () => {
  process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = SUPER_ID;
  process.env.EWC_MCP_ENABLED = "true";
  process.env.EWC_MCP_RATE_LIMIT_PER_MINUTE = "100";
  process.env.EWC_MCP_ALLOWED_ORIGINS = "http://localhost";

  const admins = await import("@bot/db/ewcAdmins.js");
  await admins.upsertEwcAdmin({ discordId: SCOPED_ID, displayName: "Scoped Admin" });
  await admins.setEwcAdminGameScopes(SCOPED_ID, [GAME_ALLOWED]);
  await admins.setEwcAdminMediaScopes(SCOPED_ID, [MEDIA_ALLOWED]);

  ({ POST: mcpPOST } = await import("@/app/api/mcp/route"));
});

function mcpRequest(secret: string | null, body: unknown, origin = "http://localhost") {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Host: "localhost",
    Origin: origin,
  };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return new Request("http://localhost/api/mcp", {
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

async function createKey(input: {
  ownerDiscordId?: string;
  tools?: string[];
  games?: string[];
  media?: string[];
  expiresAt?: number;
}) {
  const { createMcpKey } = await import("@bot/db/mcpKeys.js");
  return createMcpKey({
    ownerDiscordId: input.ownerDiscordId ?? SUPER_ID,
    ownerName: "MCP Owner",
    tools: input.tools,
    games: input.games,
    media: input.media,
    expiresAt: input.expiresAt,
  });
}

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  };
}

async function writeCounts() {
  const { all } = await import("@bot/db/client.js");
  const [postRows, auditRows] = await Promise.all([
    all("SELECT COUNT(*) AS c FROM ewc_news_posts"),
    all("SELECT COUNT(*) AS c FROM ewc_admin_audit_log"),
  ]);
  return {
    posts: Number(postRows[0]?.c ?? 0),
    audit: Number(auditRows[0]?.c ?? 0),
  };
}

async function expectCreateDraftErrorWithoutWrite(
  secret: string,
  args: Record<string, unknown>,
  message?: RegExp,
) {
  const before = await writeCounts();
  const response = await mcpPOST(mcpRequest(secret, toolCall("create_news_draft", args)));
  expect(response.status).toBe(200);
  const body = await parseMcpResponse(response);
  expect(body.result?.isError === true || Boolean(body.error)).toBe(true);
  if (message) {
    const text = String(body.result?.content?.[0]?.text ?? body.error?.message ?? body.error ?? "");
    expect(text).toMatch(message);
  }
  await expect(writeCounts()).resolves.toEqual(before);
  return body;
}

describe("/api/mcp auth", () => {
  test("rejects missing bearer key", async () => {
    const response = await mcpPOST(mcpRequest(null, toolCall("get_site_overview")));
    expect(response.status).toBe(401);
  });

  test("rejects unauthenticated batch requests at the auth boundary", async () => {
    const response = await mcpPOST(
      mcpRequest(null, [
        toolCall("get_site_overview"),
        toolCall("get_site_overview"),
      ]),
    );
    expect(response.status).toBe(401);
  });

  test("rejects invalid bearer key", async () => {
    const response = await mcpPOST(mcpRequest("ec_mcp_live_invalid", toolCall("get_site_overview")));
    expect(response.status).toBe(401);
  });

  test("rejects revoked and expired keys", async () => {
    const { revokeMcpKey } = await import("@bot/db/mcpKeys.js");
    const revoked = await createKey({ tools: ["get_site_overview"] });
    await revokeMcpKey(revoked.key.id);
    expect((await mcpPOST(mcpRequest(revoked.secret, toolCall("get_site_overview")))).status).toBe(401);

    const expired = await createKey({
      tools: ["get_site_overview"],
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    });
    expect((await mcpPOST(mcpRequest(expired.secret, toolCall("get_site_overview")))).status).toBe(401);
  });

  test("rejects disallowed browser origins", async () => {
    const key = await createKey({ tools: ["get_site_overview"] });
    const response = await mcpPOST(
      mcpRequest(key.secret, toolCall("get_site_overview"), "https://evil.example"),
    );
    expect(response.status).toBe(403);
  });
});

describe("/api/mcp tools", () => {
  test("lists public read tools on the admin MCP endpoint", async () => {
    const key = await createKey({ tools: ["get_site_overview"] });
    const response = await mcpPOST(
      mcpRequest(key.secret, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    );

    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_games",
        "list_tournaments",
        "list_co_streams",
        "search_teams",
        "search_players",
        "get_public_ewc_leaderboard",
      ]),
    );
  });

  test("runs public-only read tools through admin MCP without a second MCP config", async () => {
    const key = await createKey({ tools: ["get_site_overview"] });
    const response = await mcpPOST(mcpRequest(key.secret, toolCall("list_games", { locale: "en" })));

    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent.games).toEqual(expect.any(Array));
  });

  test("runs a read-only overview tool for a valid super-admin key", async () => {
    const key = await createKey({ tools: ["get_site_overview"] });
    const { recordAdminAudit } = await import("@bot/db/ewcAdminAuditLog.js");
    await recordAdminAudit({
      actorId: SUPER_ID,
      actorName: "Super Admin",
      action: "test.super_action",
      target: "mcp-test",
      details: { source: "mcp-api-test" },
    });

    const response = await mcpPOST(mcpRequest(key.secret, toolCall("get_site_overview")));
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.structuredContent).toMatchObject({
      games: expect.any(Number),
      live_matches: expect.any(Number),
      recentAudit: expect.any(Array),
    });
  });

  test("omits recent audit rows from scoped overview keys", async () => {
    const key = await createKey({
      ownerDiscordId: SCOPED_ID,
      tools: ["get_site_overview"],
      games: ["valorant"],
    });
    const response = await mcpPOST(mcpRequest(key.secret, toolCall("get_site_overview")));
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.structuredContent).toMatchObject({
      games: expect.any(Number),
      live_matches: expect.any(Number),
    });
    expect(body.result.structuredContent).not.toHaveProperty("recentAudit");
  });

  test("rejects JSON-RPC batch arrays before tool dispatch", async () => {
    const key = await createKey({ tools: ["get_site_overview"] });
    const response = await mcpPOST(
      mcpRequest(key.secret, [
        toolCall("get_site_overview"),
        toolCall("get_site_overview"),
      ]),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/batch/i),
    });
  });

  test("creates a news draft and records an MCP audit actor", async () => {
    const key = await createKey({ tools: ["create_news_draft", "search_news"], games: [GAME_ALLOWED] });
    const response = await mcpPOST(
      mcpRequest(
        key.secret,
        toolCall("create_news_draft", {
          title: "MCP draft title",
          summary: "Draft summary",
          body: "Draft body",
          gameSlug: GAME_ALLOWED,
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);

    const { listEwcNewsPostsForAdmin } = await import("@bot/db/ewcNewsPosts.js");
    const drafts = await listEwcNewsPostsForAdmin({ gameSlug: GAME_ALLOWED, status: "draft" });
    expect(drafts.some((post) => post.title === "MCP draft title")).toBe(true);

    const { listAdminAuditLog } = await import("@bot/db/ewcAdminAuditLog.js");
    const audit = await listAdminAuditLog(20, 0);
    const entry = audit.find((row) => row.action === "mcp.news.create_draft");
    expect(entry?.actorId).toContain(`mcp:${key.key.id}:`);
    expect(entry?.details).toMatchObject({ keyPrefix: key.key.keyPrefix, gameSlug: GAME_ALLOWED });
  });

  test("accepts canonical maximum news draft lengths", async () => {
    const key = await createKey({ tools: ["create_news_draft"], games: [GAME_ALLOWED] });
    const title = "T".repeat(NEWS_TITLE_MAX_LENGTH);
    const summary = "S".repeat(NEWS_SUMMARY_MAX_LENGTH);
    const bodyText = "B".repeat(NEWS_BODY_MAX_LENGTH);
    const response = await mcpPOST(
      mcpRequest(
        key.secret,
        toolCall("create_news_draft", {
          title,
          summary,
          body: bodyText,
          gameSlug: GAME_ALLOWED,
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent.post).toMatchObject({
      title,
      summary,
      body: bodyText,
      status: "draft",
      gameSlug: GAME_ALLOWED,
    });
  });

  test("rejects news draft text over canonical limits without writing", async () => {
    const key = await createKey({ tools: ["create_news_draft"], games: [GAME_ALLOWED] });
    await expectCreateDraftErrorWithoutWrite(key.secret, {
      title: "T".repeat(NEWS_TITLE_MAX_LENGTH + 1),
      summary: "Draft summary",
      body: "Draft body",
      gameSlug: GAME_ALLOWED,
    });
    await expectCreateDraftErrorWithoutWrite(key.secret, {
      title: "Valid title",
      summary: "S".repeat(NEWS_SUMMARY_MAX_LENGTH + 1),
      body: "Draft body",
      gameSlug: GAME_ALLOWED,
    });
    await expectCreateDraftErrorWithoutWrite(key.secret, {
      title: "Valid title",
      summary: "Draft summary",
      body: "B".repeat(NEWS_BODY_MAX_LENGTH + 1),
      gameSlug: GAME_ALLOWED,
    });
  });

  test("rejects unknown news draft owners without writing", async () => {
    const key = await createKey({ tools: ["create_news_draft"], media: [MEDIA_ALLOWED] });
    await expectCreateDraftErrorWithoutWrite(key.secret, {
      title: "Unknown game draft",
      gameSlug: "missing-game",
    }, /Unknown game/);
    await expectCreateDraftErrorWithoutWrite(key.secret, {
      title: "Unknown media draft",
      mediaSlug: "missing-media",
    }, /Unknown media channel/);
    await expectCreateDraftErrorWithoutWrite(key.secret, {
      title: "Unknown related game draft",
      mediaSlug: MEDIA_ALLOWED,
      gameSlug: "missing-game",
    }, /Unknown game/);
  });

  test("creates an incomplete draft as draft with the key owner as author", async () => {
    const key = await createKey({
      ownerDiscordId: SCOPED_ID,
      tools: ["create_news_draft"],
      games: [GAME_ALLOWED],
    });
    const response = await mcpPOST(
      mcpRequest(
        key.secret,
        toolCall("create_news_draft", {
          title: "Incomplete MCP draft",
          gameSlug: GAME_ALLOWED,
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent.post).toMatchObject({
      title: "Incomplete MCP draft",
      summary: "",
      body: "",
      status: "draft",
      authorDiscordId: SCOPED_ID,
      authorName: "MCP Owner",
    });
  });

  test("media-owned draft may include a related game outside game scope", async () => {
    const key = await createKey({
      ownerDiscordId: SCOPED_ID,
      tools: ["create_news_draft"],
      media: [MEDIA_ALLOWED],
    });
    const response = await mcpPOST(
      mcpRequest(
        key.secret,
        toolCall("create_news_draft", {
          title: "Media related game draft",
          mediaSlug: MEDIA_ALLOWED,
          gameSlug: GAME_OUTSIDE_SCOPE,
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent.post).toMatchObject({
      title: "Media related game draft",
      mediaSlug: MEDIA_ALLOWED,
      gameSlug: GAME_OUTSIDE_SCOPE,
      status: "draft",
      authorDiscordId: SCOPED_ID,
    });
  });

  test("scoped key cannot create drafts outside the owner's game scopes", async () => {
    const key = await createKey({
      ownerDiscordId: SCOPED_ID,
      tools: ["create_news_draft"],
      games: [GAME_OUTSIDE_SCOPE],
    });
    await expectCreateDraftErrorWithoutWrite(key.secret, {
      title: "Blocked MCP draft",
      summary: "",
      body: "",
      gameSlug: GAME_OUTSIDE_SCOPE,
    }, /cannot draft/i);
  });

  test("scoped stream updates do not propagate to sibling channels outside the key scope", async () => {
    const { createStreamChannel, getStreamChannel } = await import("@bot/db/streamChannels.js");
    const allowed = await createStreamChannel({
      platform: "twitch",
      handle: "scoped_valorant_tw",
      label: "Scoped Old",
      creatorKey: "scoped-caster",
      scope: "game",
      gameSlug: "valorant",
    });
    const blocked = await createStreamChannel({
      platform: "kick",
      handle: "scoped_dota_kk",
      label: "Scoped Old",
      creatorKey: "scoped-caster",
      scope: "game",
      gameSlug: "dota2",
    });
    const key = await createKey({
      ownerDiscordId: SCOPED_ID,
      tools: ["update_stream_channel"],
      games: ["valorant"],
    });

    const response = await mcpPOST(
      mcpRequest(
        key.secret,
        toolCall("update_stream_channel", { id: allowed.id, label: "Scoped New" }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);

    await expect(getStreamChannel(allowed.id)).resolves.toMatchObject({ label: "Scoped New" });
    await expect(getStreamChannel(blocked.id)).resolves.toMatchObject({ label: "Scoped Old" });
  });
});
