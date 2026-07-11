import { beforeAll, describe, expect, test } from "vitest";

// Body-admission hardening for both MCP surfaces (ECB-SEC-005 + admin
// parity): one bounded streaming parse, 413 on overflow, 400 on malformed
// JSON, batch rejection intact, and the parsed body handed to the SDK
// transport exactly once.

let publicMcpPOST: (request: Request) => Promise<Response>;
let adminMcpPOST: (request: Request) => Promise<Response>;
let adminSecret = "";

const SUPER_ID = "123456789012345678";
const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

beforeAll(async () => {
  process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = SUPER_ID;
  process.env.EWC_MCP_ENABLED = "true";
  process.env.EWC_MCP_RATE_LIMIT_PER_MINUTE = "100";
  process.env.EWC_MCP_ALLOWED_ORIGINS = "http://localhost";
  process.env.EWC_PUBLIC_MCP_ENABLED = "true";
  process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = "100";
  process.env.EWC_PUBLIC_MCP_ALLOWED_ORIGINS = "http://localhost";
  process.env.EWC_DASHBOARD_PUBLIC_URL = "http://localhost";

  ({ POST: publicMcpPOST } = await import("@/app/api/public-mcp/route"));
  ({ POST: adminMcpPOST } = await import("@/app/api/mcp/route"));

  const { createMcpKey } = await import("@bot/db/mcpKeys.js");
  const created = await createMcpKey({ ownerDiscordId: SUPER_ID, tools: ["get_site_overview"] });
  adminSecret = created.secret;
});

function baseHeaders(extra: Record<string, string> = {}) {
  return {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Host: "localhost",
    Origin: "http://localhost",
    ...extra,
  };
}

function publicRequest(body: BodyInit, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return new Request("http://localhost/api/public-mcp", {
    method: "POST",
    headers: baseHeaders({ "cf-connecting-ip": "203.0.113.90", ...headers }),
    body,
    ...init,
  });
}

function adminRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: baseHeaders({ Authorization: `Bearer ${adminSecret}`, ...headers }),
    body,
  });
}

function oversizedJson() {
  return JSON.stringify({ ...toolsList, pad: "x".repeat(70 * 1024) });
}

function chunkedStream(text: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, 512)));
      controller.enqueue(encoder.encode(text.slice(512)));
      controller.close();
    },
  });
}

describe("MCP body admission", () => {
  test("public MCP rejects an oversized body with 413", async () => {
    const response = await publicMcpPOST(publicRequest(oversizedJson()));
    expect(response.status).toBe(413);
  });

  test("public MCP rejects an oversized chunked body without Content-Length", async () => {
    const request = publicRequest(chunkedStream(oversizedJson()), {}, {
      // @ts-expect-error duplex is required by undici for stream bodies
      duplex: "half",
    });
    expect((await publicMcpPOST(request)).status).toBe(413);
  });

  test("public MCP rejects malformed JSON with 400", async () => {
    expect((await publicMcpPOST(publicRequest("{not json"))).status).toBe(400);
  });

  test("public MCP still rejects JSON-RPC batch arrays", async () => {
    const response = await publicMcpPOST(publicRequest(JSON.stringify([toolsList])));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/batch/i),
    });
  });

  test("public MCP serves a bounded valid request with a single parse", async () => {
    const response = await publicMcpPOST(publicRequest(JSON.stringify(toolsList)));
    expect(response.status).toBe(200);
  });

  test("admin MCP rejects an oversized body with 413", async () => {
    expect((await adminMcpPOST(adminRequest(oversizedJson()))).status).toBe(413);
  });

  test("admin MCP rejects malformed JSON with 400", async () => {
    expect((await adminMcpPOST(adminRequest("{not json"))).status).toBe(400);
  });

  test("admin MCP still rejects batch arrays and serves valid requests", async () => {
    expect((await adminMcpPOST(adminRequest(JSON.stringify([toolsList])))).status).toBe(400);
    expect((await adminMcpPOST(adminRequest(JSON.stringify(toolsList)))).status).toBe(200);
  });

  test("admin MCP auth still precedes body admission", async () => {
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: baseHeaders(),
      body: oversizedJson(),
    });
    expect((await adminMcpPOST(request)).status).toBe(401);
  });
});
