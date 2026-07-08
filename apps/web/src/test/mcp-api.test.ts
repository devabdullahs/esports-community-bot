import { beforeAll, describe, expect, test } from "vitest";

let mcpPOST: (request: Request) => Promise<Response>;

const SUPER_ID = "123456789012345678";
const SCOPED_ID = "223456789012345678";

beforeAll(async () => {
  process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = SUPER_ID;
  process.env.EWC_MCP_ENABLED = "true";
  process.env.EWC_MCP_RATE_LIMIT_PER_MINUTE = "100";
  process.env.EWC_MCP_ALLOWED_ORIGINS = "http://localhost";

  const admins = await import("@bot/db/ewcAdmins.js");
  await admins.upsertEwcAdmin({ discordId: SCOPED_ID, displayName: "Scoped Admin" });
  await admins.setEwcAdminGameScopes(SCOPED_ID, ["valorant"]);
  await admins.setEwcAdminMediaScopes(SCOPED_ID, []);

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
  expiresAt?: number;
}) {
  const { createMcpKey } = await import("@bot/db/mcpKeys.js");
  return createMcpKey({
    ownerDiscordId: input.ownerDiscordId ?? SUPER_ID,
    ownerName: "MCP Owner",
    tools: input.tools,
    games: input.games,
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
    const key = await createKey({ tools: ["create_news_draft", "search_news"], games: ["valorant"] });
    const response = await mcpPOST(
      mcpRequest(
        key.secret,
        toolCall("create_news_draft", {
          title: "MCP draft title",
          summary: "Draft summary",
          body: "Draft body",
          gameSlug: "valorant",
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).not.toBe(true);

    const { listEwcNewsPostsForAdmin } = await import("@bot/db/ewcNewsPosts.js");
    const drafts = await listEwcNewsPostsForAdmin({ gameSlug: "valorant", status: "draft" });
    expect(drafts.some((post) => post.title === "MCP draft title")).toBe(true);

    const { listAdminAuditLog } = await import("@bot/db/ewcAdminAuditLog.js");
    const audit = await listAdminAuditLog(20, 0);
    const entry = audit.find((row) => row.action === "mcp.news.create_draft");
    expect(entry?.actorId).toContain(`mcp:${key.key.id}:`);
    expect(entry?.details).toMatchObject({ keyPrefix: key.key.keyPrefix, gameSlug: "valorant" });
  });

  test("scoped key cannot create drafts outside the owner's game scopes", async () => {
    const key = await createKey({
      ownerDiscordId: SCOPED_ID,
      tools: ["create_news_draft"],
      games: ["dota2"],
    });
    const response = await mcpPOST(
      mcpRequest(
        key.secret,
        toolCall("create_news_draft", {
          title: "Blocked MCP draft",
          summary: "",
          body: "",
          gameSlug: "dota2",
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await parseMcpResponse(response);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/cannot draft/i);
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
