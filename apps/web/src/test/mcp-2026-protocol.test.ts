import { beforeAll, describe, expect, test } from "vitest";
import { PUBLIC_MCP_TOOL_NAMES } from "@/lib/mcp-tool-manifest";

// Conformance for MCP revision 2026-07-28 served alongside the handshake-based
// revisions the SDK implements. The legacy regression at the bottom is the point
// of the dual-era design: shipping the new revision must not strand the clients
// that exist today.

const MODERN = "2026-07-28";
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

const SUPER_ID = "123456789012345678";

let publicMcpPOST: (request: Request) => Promise<Response>;
let adminMcpPOST: (request: Request) => Promise<Response>;
let adminSecret = "";

beforeAll(async () => {
  process.env.EWC_PUBLIC_MCP_ENABLED = "true";
  process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE = "500";
  process.env.EWC_PUBLIC_MCP_ALLOWED_ORIGINS = "http://localhost";
  process.env.EWC_DASHBOARD_PUBLIC_URL = "http://localhost";
  process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = SUPER_ID;
  process.env.EWC_MCP_ENABLED = "true";
  process.env.EWC_MCP_RATE_LIMIT_PER_MINUTE = "500";
  process.env.EWC_MCP_ALLOWED_ORIGINS = "http://localhost";

  const { createMcpKey } = await import("@bot/db/mcpKeys.js");
  const key = await createMcpKey({
    ownerDiscordId: SUPER_ID,
    ownerName: "Protocol Test Owner",
    tools: ["get_site_overview"],
  });
  adminSecret = key.secret;

  ({ POST: publicMcpPOST } = await import("@/app/api/public-mcp/route"));
  ({ POST: adminMcpPOST } = await import("@/app/api/mcp/route"));
});

type JsonRpcBody = {
  jsonrpc: string;
  id?: unknown;
  method: string;
  params?: Record<string, unknown>;
};

function modernBody(
  method: string,
  params: Record<string, unknown> = {},
  options: { id?: unknown; version?: string; omitId?: boolean } = {},
): JsonRpcBody {
  const body: JsonRpcBody = {
    jsonrpc: "2.0",
    method,
    params: {
      ...params,
      _meta: {
        [META_VERSION]: options.version ?? MODERN,
        [META_CLIENT_INFO]: { name: "ConformanceClient", version: "1.0.0" },
        [META_CLIENT_CAPABILITIES]: {},
      },
    },
  };
  if (!options.omitId) body.id = options.id ?? 1;
  return body;
}

// Mirrors the body fields the transport requires in headers, exactly as a
// conforming client would.
function modernHeaders(body: JsonRpcBody, overrides: Record<string, string | null> = {}) {
  const meta = (body.params?._meta ?? {}) as Record<string, unknown>;
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Host: "localhost",
    Origin: "http://localhost",
    "MCP-Protocol-Version": String(meta[META_VERSION] ?? MODERN),
    "Mcp-Method": body.method,
  };
  const name = body.params?.name;
  if (typeof name === "string") headers["Mcp-Name"] = name;

  for (const [header, value] of Object.entries(overrides)) {
    if (value === null) delete headers[header];
    else headers[header] = value;
  }
  return headers;
}

let ipCounter = 0;

function nextIp() {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 200) + 20}`;
}

function publicRequest(body: unknown, headers: Record<string, string>) {
  return new Request("http://localhost/api/public-mcp", {
    method: "POST",
    headers: { ...headers, "cf-connecting-ip": nextIp() },
    body: JSON.stringify(body),
  });
}

function adminRequest(body: unknown, headers: Record<string, string>) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${adminSecret}` },
    body: JSON.stringify(body),
  });
}

function callPublic(body: JsonRpcBody, overrides: Record<string, string | null> = {}) {
  return publicMcpPOST(publicRequest(body, modernHeaders(body, overrides)));
}

// Modern responses are plain JSON, but the legacy fallback answers over SSE, so
// legacy assertions go through this rather than `response.json()`.
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

describe("MCP 2026-07-28 — discovery", () => {
  test("server/discover advertises both eras, capabilities, and identity", async () => {
    const response = await callPublic(modernBody("server/discover"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.result.resultType).toBe("complete");
    // Modern revisions only. Legacy clients never reach server/discover — they
    // open with `initialize`, which the legacy fallback still answers.
    expect(body.result.supportedVersions).toEqual([MODERN]);
    // listChanged is advertised because the SDK serves subscriptions/listen,
    // which gives the notification somewhere to be delivered.
    expect(body.result.capabilities).toEqual({ tools: { listChanged: true } });
    expect(body.result._meta[META_SERVER_INFO]).toEqual({
      name: "esports-community-public",
      version: "0.1.0",
    });
    expect(body.result.cacheScope).toBe("public");
    expect(typeof body.result.ttlMs).toBe("number");
    expect(typeof body.result.instructions).toBe("string");
  });
});

describe("MCP 2026-07-28 — tools", () => {
  test("tools/list carries resultType, cache hints, and serverInfo", async () => {
    const response = await callPublic(modernBody("tools/list"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.result.resultType).toBe("complete");
    expect(body.result.ttlMs).toBe(300_000);
    expect(body.result.cacheScope).toBe("public");
    expect(body.result._meta[META_SERVER_INFO].name).toBe("esports-community-public");

    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect([...names].sort()).toEqual([...PUBLIC_MCP_TOOL_NAMES].sort());
  });

  test("tools/call returns a complete result with structured content", async () => {
    const response = await callPublic(
      modernBody("tools/call", { name: "get_site_overview", arguments: {} }),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.result.resultType).toBe("complete");
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent).toMatchObject({ games: expect.any(Number) });
    expect(body.result._meta[META_SERVER_INFO]).toBeTruthy();
  });

  test("tools/call accepts a base64-sentinel Mcp-Name", async () => {
    const encoded = `=?base64?${Buffer.from("get_site_overview", "utf8").toString("base64")}?=`;
    const response = await callPublic(
      modernBody("tools/call", { name: "get_site_overview", arguments: {} }),
      { "Mcp-Name": encoded },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.result.resultType).toBe("complete");
  });

  test("tool execution errors stay in-band as isError results", async () => {
    const response = await callPublic(
      modernBody("tools/call", {
        name: "get_public_ewc_leaderboard",
        arguments: { guildId: "910000000000000777", season: "2077" },
      }),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.result.resultType).toBe("complete");
    expect(body.result.isError).toBe(true);
  });
});

describe("MCP 2026-07-28 — header validation", () => {
  test("missing Mcp-Method is a HeaderMismatch", async () => {
    const response = await callPublic(modernBody("tools/list"), { "Mcp-Method": null });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe(-32020);
    expect(body.id).toBe(1);
  });

  // Documents a known leniency in the reference implementation rather than the
  // letter of the spec, which lists "a required standard header is missing"
  // (naming MCP-Protocol-Version) as a HeaderMismatch condition. The SDK instead
  // takes the version from the body `_meta` and serves the request. Pinned here
  // so an SDK upgrade that tightens this shows up as a test failure, not as a
  // silent change in what we accept.
  test("a missing MCP-Protocol-Version is served from the body _meta", async () => {
    const response = await callPublic(modernBody("tools/list"), {
      "MCP-Protocol-Version": null,
      "Mcp-Method": "tools/list",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.resultType).toBe("complete");
  });

  test("Mcp-Method that disagrees with the body is rejected", async () => {
    const response = await callPublic(modernBody("tools/list"), { "Mcp-Method": "tools/call" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32020);
  });

  test("Mcp-Name that disagrees with the body is rejected", async () => {
    const response = await callPublic(
      modernBody("tools/call", { name: "get_site_overview", arguments: {} }),
      { "Mcp-Name": "list_games" },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32020);
  });

  test("header/body protocol version disagreement is rejected", async () => {
    const body = modernBody("tools/list");
    const response = await callPublic(body, { "MCP-Protocol-Version": "2025-11-25" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32020);
  });

  test("a malformed base64 sentinel is reported as a bad header, not a name mismatch", async () => {
    const response = await callPublic(
      modernBody("tools/call", { name: "get_site_overview", arguments: {} }),
      { "Mcp-Name": "=?base64?not!valid!base64?=" },
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe(-32020);
    expect(body.error.message).toMatch(/base64/i);
  });
});

describe("MCP 2026-07-28 — version negotiation and method surface", () => {
  test("an unsupported future revision returns the supported list", async () => {
    const response = await callPublic(
      modernBody("tools/list", {}, { version: "2027-01-01" }),
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.requested).toBe("2027-01-01");
    expect(body.error.data.supported).toContain(MODERN);
  });

  test("an unknown revision in the header alone still reaches the modern error", async () => {
    // Header-only modern declaration: routed here rather than silently falling
    // through to the legacy handshake, which would leave the client no way out.
    const body = { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} };
    const response = await publicMcpPOST(
      publicRequest(body, {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Host: "localhost",
        Origin: "http://localhost",
        "MCP-Protocol-Version": "2030-01-01",
        "Mcp-Method": "tools/list",
      }),
    );
    expect(response.status).toBe(400);
    // The body carries no modern _meta, so it is rejected as a malformed modern
    // request (invalid params) rather than reaching version negotiation.
    expect((await response.json()).error.code).toBe(-32602);
  });

  test("methods removed in this revision are 404 with a JSON-RPC error", async () => {
    for (const method of ["initialize", "ping", "logging/setLevel"]) {
      const response = await callPublic(modernBody(method));
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error.code).toBe(-32601);
    }
  });

  test("features this server does not implement are 404, not a silent empty result", async () => {
    // We register tools only. An empty resources/prompts list would falsely imply
    // the server offers those features and has nothing in them.
    for (const method of ["resources/list", "prompts/list"]) {
      const response = await callPublic(modernBody(method));
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe(-32601);
    }
  });

  test("a notification is accepted with 202 and no body", async () => {
    const response = await callPublic(
      modernBody("notifications/progress", {}, { omitId: true }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
});

describe("MCP 2026-07-28 — admin surface", () => {
  test("the admin tool list is marked private so intermediaries cannot share it", async () => {
    const body = modernBody("tools/list");
    const response = await adminMcpPOST(adminRequest(body, modernHeaders(body)));
    expect(response.status).toBe(200);

    const parsed = await response.json();
    expect(parsed.result.resultType).toBe("complete");
    expect(parsed.result.cacheScope).toBe("private");
    expect(parsed.result._meta[META_SERVER_INFO].name).toBe("esports-community-admin");
  });

  test("the modern era does not bypass bearer authentication", async () => {
    const body = modernBody("tools/list");
    const response = await adminMcpPOST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: modernHeaders(body),
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe("legacy era regression", () => {
  test("a handshake client still gets a 2025-era response with no 2026 fields", async () => {
    const response = await publicMcpPOST(
      publicRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          Host: "localhost",
          Origin: "http://localhost",
        },
      ),
    );
    expect(response.status).toBe(200);

    const body = await parseMcpResponse(response);
    expect(body.result.tools.length).toBe(PUBLIC_MCP_TOOL_NAMES.length);
    // 2026-only fields must not leak into a 2025-era answer.
    expect(body.result.resultType).toBeUndefined();
    expect(body.result.cacheScope).toBeUndefined();
    expect(body.result.ttlMs).toBeUndefined();
  });

  test("initialize still negotiates a legacy revision", async () => {
    const response = await publicMcpPOST(
      publicRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "LegacyClient", version: "1.0.0" },
          },
        },
        {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          Host: "localhost",
          Origin: "http://localhost",
        },
      ),
    );
    expect(response.status).toBe(200);

    const body = await parseMcpResponse(response);
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo.name).toBe("esports-community-public");
  });
});
