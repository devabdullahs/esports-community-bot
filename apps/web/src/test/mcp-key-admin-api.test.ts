import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { AdminAccess } from "@/lib/admin";
import {
  ADMIN_SELECTABLE_MCP_TOOL_NAMES,
  PUBLIC_ONLY_MCP_TOOL_NAMES,
} from "@/lib/mcp-tool-manifest";
import { gamesAdmin, nonAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { getAdminAccess } from "@/lib/admin";
import { GET as keysGET, POST as keysPOST } from "@/app/api/admin/mcp-keys/route";
import { DELETE as keyDELETE } from "@/app/api/admin/mcp-keys/[id]/route";

const mockAccess = vi.mocked(getAdminAccess);

const GAME_ALLOWED = "mcp-self-valorant";
const GAME_BLOCKED = "mcp-self-dota";
const MEDIA_ALLOWED = "mcp-self-media";
const MEDIA_BLOCKED = "mcp-self-blocked-media";
const SCOPED_ID = "123456789012345679";
const PUBLIC_KEY_FIELDS = [
  "createdAt",
  "createdBy",
  "expiresAt",
  "games",
  "id",
  "keyPrefix",
  "label",
  "lastUsedAt",
  "media",
  "ownerDiscordId",
  "ownerName",
  "revokedAt",
  "tools",
].sort();

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/mcp-keys", {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      Host: "localhost",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function scopedAccess(): AdminAccess {
  return {
    ...gamesAdmin([GAME_ALLOWED]),
    discordUserId: SCOPED_ID,
    displayName: "Scoped MCP Admin",
    media: [MEDIA_ALLOWED],
    allowed: true,
  };
}

function expectPublicKeyShape(key: Record<string, unknown>) {
  expect(Object.keys(key).sort()).toEqual(PUBLIC_KEY_FIELDS);
  expect(key).not.toHaveProperty("keyHash");
  expect(key).not.toHaveProperty("key_hash");
  expect(key).not.toHaveProperty("secret");
}

async function seedGame(slug: string) {
  const { createEwcGame } = await import("@bot/db/ewcGames.js");
  try {
    await createEwcGame({
      slug,
      title: { en: slug, ar: slug },
      description: { en: "", ar: "" },
      status: { en: "", ar: "" },
      owner: { en: "", ar: "" },
      focus: [],
    });
  } catch {
    // already exists
  }
}

async function seedMedia(slug: string) {
  const { createEwcMediaChannel } = await import("@bot/db/ewcMediaChannels.js");
  try {
    await createEwcMediaChannel({
      slug,
      name: { en: slug, ar: slug },
      description: { en: "", ar: "" },
      links: [],
    });
  } catch {
    // already exists
  }
}

describe("/api/admin/mcp-keys self-service", () => {
  beforeAll(async () => {
    process.env.EWC_MCP_ENABLED = "true";
    process.env.EWC_MCP_RATE_LIMIT_PER_MINUTE = "100";
    const admins = await import("@bot/db/ewcAdmins.js");
    await admins.upsertEwcAdmin({ discordId: SCOPED_ID, displayName: "Scoped MCP Admin" });
    await admins.setEwcAdminGameScopes(SCOPED_ID, [GAME_ALLOWED]);
    await admins.setEwcAdminMediaScopes(SCOPED_ID, [MEDIA_ALLOWED]);
    await Promise.all([
      seedGame(GAME_ALLOWED),
      seedGame(GAME_BLOCKED),
      seedMedia(MEDIA_ALLOWED),
      seedMedia(MEDIA_BLOCKED),
    ]);
  });

  beforeEach(() => {
    mockAccess.mockReset();
  });

  test("allows scoped admins to create only their own scoped key", async () => {
    mockAccess.mockResolvedValue(scopedAccess());

    const response = await keysPOST(req("POST", {
      label: "Scoped key",
      ownerDiscordId: "999999999999999999",
      ownerName: "Spoofed",
      tools: ["get_site_overview", "create_news_draft", "not_a_tool"],
      games: [GAME_ALLOWED, GAME_BLOCKED],
      media: [MEDIA_ALLOWED, MEDIA_BLOCKED],
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["key", "secret"]);
    expect(body.secret).toMatch(/^ec_mcp_live_/);
    expectPublicKeyShape(body.key);
    expect(body.key).toMatchObject({
      ownerDiscordId: SCOPED_ID,
      ownerName: "Scoped MCP Admin",
      games: [GAME_ALLOWED],
      media: [MEDIA_ALLOWED],
    });
    expect(body.key.tools).toEqual(["create_news_draft", "get_site_overview"]);
  });

  test("rejects keys with zero selectable tools, including non-manifest names", async () => {
    mockAccess.mockResolvedValue(scopedAccess());

    // Always-on names (list_games) and unknown names are filtered before the
    // zero-tools check, so all three payloads must 400.
    for (const tools of [[], ["not_a_tool"], ["list_games"]]) {
      const response = await keysPOST(req("POST", { label: "Empty", tools }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/at least one/i);
    }
  });

  test("scoped admin keys with cleared scopes do not silently become full-scope keys", async () => {
    mockAccess.mockResolvedValue(scopedAccess());

    const response = await keysPOST(req("POST", {
      label: "Public-only",
      tools: ["get_site_overview"],
      games: [],
      media: [],
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expectPublicKeyShape(body.key);
    expect(body.key.games).toEqual([]);
    expect(body.key.media).toEqual([]);

    const { resolveMcpAccess } = await import("@/lib/mcp-auth");
    const resolved = await resolveMcpAccess(new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${body.secret}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Host: "localhost",
      },
      body: "{}",
    }));
    expect("access" in resolved ? resolved.access.games : null).toEqual([]);
    expect("access" in resolved ? resolved.access.media : null).toEqual([]);
  });

  test("scoped admins list only their own keys", async () => {
    const { createMcpKey } = await import("@bot/db/mcpKeys.js");
    const own = await createMcpKey({ ownerDiscordId: SCOPED_ID, tools: ["get_site_overview"] });
    const other = await createMcpKey({ ownerDiscordId: "222222222222222222", tools: ["get_site_overview"] });

    mockAccess.mockResolvedValue(scopedAccess());
    const response = await keysGET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect([...body.tools].sort()).toEqual([...ADMIN_SELECTABLE_MCP_TOOL_NAMES].sort());
    const ids = body.keys.map((key: { id: number }) => key.id);
    expect(ids).toContain(own.key.id);
    expect(ids).not.toContain(other.key.id);
    body.keys.forEach((key: Record<string, unknown>) => expectPublicKeyShape(key));
    expect(body.keys.every((key: { ownerDiscordId: string }) => key.ownerDiscordId === SCOPED_ID)).toBe(true);
  });

  test("key creation accepts only selectable admin grants", async () => {
    mockAccess.mockResolvedValue(scopedAccess());

    const rejected = await keysPOST(req("POST", {
      label: "Only always-on",
      tools: [PUBLIC_ONLY_MCP_TOOL_NAMES[0]],
      games: [GAME_ALLOWED],
      media: [MEDIA_ALLOWED],
    }));
    expect(rejected.status).toBe(400);

    const mixed = await keysPOST(req("POST", {
      label: "Mixed grants",
      tools: [PUBLIC_ONLY_MCP_TOOL_NAMES[0], "create_news_draft"],
      games: [GAME_ALLOWED],
      media: [MEDIA_ALLOWED],
    }));
    expect(mixed.status).toBe(201);
    const body = await mixed.json();
    expectPublicKeyShape(body.key);
    expect(body.key.tools).toEqual(["create_news_draft"]);
  });

  test("scoped admins can revoke their own keys but not another owner's key", async () => {
    const { createMcpKey, getMcpKey } = await import("@bot/db/mcpKeys.js");
    const own = await createMcpKey({ ownerDiscordId: SCOPED_ID, tools: ["get_site_overview"] });
    const other = await createMcpKey({ ownerDiscordId: "333333333333333333", tools: ["get_site_overview"] });

    mockAccess.mockResolvedValue(scopedAccess());
    expect((await keyDELETE(req("DELETE"), ctx(other.key.id))).status).toBe(403);
    expect((await keyDELETE(req("DELETE"), ctx(own.key.id))).status).toBe(200);
    await expect(getMcpKey(own.key.id)).resolves.toMatchObject({ revokedAt: expect.any(String) });
    await expect(getMcpKey(other.key.id)).resolves.toMatchObject({ revokedAt: null });
  });

  test("non-admins cannot use the MCP key admin API", async () => {
    mockAccess.mockResolvedValue(nonAdmin());
    expect((await keysGET()).status).toBe(403);
    expect((await keysPOST(req("POST", { tools: ["get_site_overview"] }))).status).toBe(403);
  });

  test("super admins still see all keys", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const response = await keysGET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.keys.length).toBeGreaterThan(0);
    body.keys.forEach((key: Record<string, unknown>) => expectPublicKeyShape(key));
    expect(new Set(body.keys.map((key: { ownerDiscordId: string }) => key.ownerDiscordId)).size).toBeGreaterThan(1);
  });
});
