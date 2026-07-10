import { beforeAll, describe, expect, test, vi } from "vitest";
import { GET as keysGET } from "@/app/api/admin/mcp-keys/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { POST as publicMcpPOST } from "@/app/api/public-mcp/route";
import { getAdminAccess } from "@/lib/admin";
import { getAdminMcpCopyPage } from "@/lib/admin-mcp-copy-page";
import {
  ADMIN_MCP_TOOL_NAMES,
  ADMIN_SELECTABLE_MCP_TOOL_NAMES,
  MCP_TOOL_MANIFEST,
  MCP_WRITE_TOOL_NAMES,
  PUBLIC_MCP_TOOL_NAMES,
} from "@/lib/mcp-tool-manifest";
import { getPublicMcpCopyPage } from "@/lib/public-mcp-copy-page";
import { superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

const mockAccess = vi.mocked(getAdminAccess);
const SUPER_ID = "123456789012345678";
const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

beforeAll(() => {
  process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = SUPER_ID;
  process.env.EWC_MCP_ENABLED = "true";
  process.env.EWC_MCP_RATE_LIMIT_PER_MINUTE = "100";
  process.env.EWC_MCP_ALLOWED_ORIGINS = "http://localhost";
  process.env.EWC_PUBLIC_MCP_ENABLED = "true";
  process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = "100";
  process.env.EWC_PUBLIC_MCP_ALLOWED_ORIGINS = "http://localhost";
  process.env.EWC_DASHBOARD_PUBLIC_URL = "http://localhost";
  mockAccess.mockResolvedValue(superAdmin());
});

function mcpRequest(secret: string, body: unknown) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Host: "localhost",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

function publicMcpRequest(body: unknown) {
  return new Request("http://localhost/api/public-mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.90",
      Host: "localhost",
      Origin: "http://localhost",
    },
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

function extractToolBulletNames(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^- `([^`]+)`/)?.[1])
    .filter((name): name is string => Boolean(name));
}

describe("MCP tool manifest", () => {
  test("has unique names and localized copy for every tool", () => {
    const names = MCP_TOOL_MANIFEST.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of MCP_TOOL_MANIFEST) {
      expect(tool.title.en.trim()).toBeTruthy();
      expect(tool.title.ar.trim()).toBeTruthy();
      expect(tool.description.en.trim()).toBeTruthy();
      expect(tool.description.ar.trim()).toBeTruthy();
    }
  });

  test("keeps public tools read-only and writes explicitly classified", () => {
    expect(MCP_TOOL_MANIFEST.filter((tool) => tool.surfaces.includes("public")).every((tool) => tool.kind === "read"))
      .toBe(true);
    expect([...MCP_WRITE_TOOL_NAMES].sort()).toEqual(["create_news_draft", "update_stream_channel"]);
    expect(MCP_TOOL_MANIFEST.filter((tool) => tool.kind === "write").map((tool) => tool.name).sort())
      .toEqual([...MCP_WRITE_TOOL_NAMES].sort());
  });

  test("distinguishes Club Championship standings from prediction rankings", () => {
    const standings = MCP_TOOL_MANIFEST.find((tool) => tool.name === "get_ewc_club_standings");
    const predictions = MCP_TOOL_MANIFEST.find((tool) => tool.name === "get_public_ewc_leaderboard");
    expect(standings).toMatchObject({ adminGrant: "always", kind: "read" });
    expect(standings?.description.en).toContain("Club Championship standings");
    expect(predictions?.description.en).toContain("prediction leaderboard");
    expect(getPublicMcpCopyPage("en")).toContain("separate datasets");
    expect(getPublicMcpCopyPage("ar")).toContain("\u0645\u062c\u0645\u0648\u0639\u062a\u0627 \u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0646\u0641\u0635\u0644\u062a\u0627\u0646");
  });

  test("matches actual tools/list registrations", async () => {
    const { createMcpKey } = await import("@bot/db/mcpKeys.js");
    const key = await createMcpKey({ ownerDiscordId: SUPER_ID, tools: ["get_site_overview"] });
    const adminResponse = await mcpPOST(mcpRequest(key.secret, toolsList));
    const publicResponse = await publicMcpPOST(publicMcpRequest(toolsList));

    expect(adminResponse.status).toBe(200);
    expect(publicResponse.status).toBe(200);

    const adminBody = await parseMcpResponse(adminResponse);
    const publicBody = await parseMcpResponse(publicResponse);
    const adminNames = adminBody.result.tools.map((tool: { name: string }) => tool.name);
    const publicNames = publicBody.result.tools.map((tool: { name: string }) => tool.name);

    expect([...adminNames].sort()).toEqual([...ADMIN_MCP_TOOL_NAMES].sort());
    expect([...publicNames].sort()).toEqual([...PUBLIC_MCP_TOOL_NAMES].sort());
  });

  test("returns only selectable grants from the key admin API", async () => {
    const response = await keysGET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect([...body.tools].sort()).toEqual([...ADMIN_SELECTABLE_MCP_TOOL_NAMES].sort());
  });

  test.each([
    ["admin", "en", getAdminMcpCopyPage, ADMIN_MCP_TOOL_NAMES],
    ["admin", "ar", getAdminMcpCopyPage, ADMIN_MCP_TOOL_NAMES],
    ["public", "en", getPublicMcpCopyPage, PUBLIC_MCP_TOOL_NAMES],
    ["public", "ar", getPublicMcpCopyPage, PUBLIC_MCP_TOOL_NAMES],
  ] as const)("mentions every %s tool exactly once in %s generated docs", (_surface, locale, getCopy, expected) => {
    const names = extractToolBulletNames(getCopy(locale));

    expect(names).toHaveLength(new Set(names).size);
    expect([...names].sort()).toEqual([...expected].sort());
  });
});
