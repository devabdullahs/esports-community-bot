import { beforeEach, describe, expect, test, vi } from "vitest";

// The era counter is what the dated removal of the 2025 handshake will be
// decided on, so it has to classify correctly — and it reads a method name off
// an untrusted body into a shared log stream, so it has to be unforgeable.

const loggerMock = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@bot/lib/logger.js", () => loggerMock);

const { logMcpProtocolEra } = await import("@/lib/mcp-era-log");
const { MCP_PROBE_USER_AGENT } = await import("@bot/lib/mcpProbeAgent.js");

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "Test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/public-mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: "{}",
  });
}

function lastLine() {
  const calls = loggerMock.logger.info.mock.calls;
  return calls.length ? String(calls[calls.length - 1][0]) : "";
}

beforeEach(() => {
  loggerMock.logger.info.mockClear();
});

describe("MCP protocol era logging", () => {
  test("classifies a handshake request as legacy and attributes its client", async () => {
    await logMcpProtocolEra("public", request(), {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "LegacyApp", version: "1" } },
    });

    expect(lastLine()).toBe("[mcp] public era=legacy method=initialize client=LegacyApp");
  });

  test("classifies an enveloped request as modern and attributes its client", async () => {
    await logMcpProtocolEra(
      "admin",
      request({ "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" }),
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } },
    );

    expect(lastLine()).toBe("[mcp] admin era=modern method=tools/list client=Test");
  });

  // Our own smoke check sends a handshake-era request every run. Counted as a
  // real client it would argue against a removal it has no stake in.
  test("tags our own smoke probe so it cannot be read as a client", async () => {
    await logMcpProtocolEra("public", request({ "User-Agent": MCP_PROBE_USER_AGENT }), {
      jsonrpc: "2.0",
      id: "smoke-legacy-list",
      method: "tools/list",
      params: {},
    });

    expect(lastLine()).toBe("[mcp] public era=legacy method=tools/list client=- probe=self");
  });

  test("does not tag a request merely claiming a similar agent", async () => {
    await logMcpProtocolEra("public", request({ "User-Agent": "esports-community-smoke/1.0" }), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(lastLine()).not.toContain("probe=self");
  });

  test("a client name cannot forge a log line either", async () => {
    await logMcpProtocolEra("public", request(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { ...MODERN_META, "io.modelcontextprotocol/clientInfo": { name: "a\nINFO [mcp] forged" } } },
    });

    const line = lastLine();
    expect(line).not.toContain("\n");
    expect(line).not.toContain("[mcp] forged");
  });

  test("a method carrying newlines cannot forge a second log line", async () => {
    await logMcpProtocolEra("public", request(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list\n[2026-08-12T00:00:00.000Z] INFO  [mcp] public era=modern method=forged",
    });

    const line = lastLine();
    expect(line).not.toContain("\n");
    expect(line).not.toContain("forged");
    // Bounded first, then stripped — so the surviving text is shorter than the
    // 40-character cap once the separators are gone.
    expect(line).toBe("[mcp] public era=legacy method=tools/list2026-08-12T000000.000Z IN client=-");
  });

  test("bounds an oversized method name", async () => {
    await logMcpProtocolEra("public", request(), {
      jsonrpc: "2.0",
      id: 1,
      method: "a".repeat(5_000),
    });

    expect(lastLine()).toBe(`[mcp] public era=legacy method=${"a".repeat(40)} client=-`);
  });

  test.each([
    ["a non-object body", "not json at all"],
    ["an array body", [1, 2, 3]],
    ["a null body", null],
    ["a body with no method", { jsonrpc: "2.0", id: 1 }],
    ["a non-string method", { jsonrpc: "2.0", id: 1, method: 42 }],
    ["a method that sanitizes to nothing", { jsonrpc: "2.0", id: 1, method: "!!!" }],
  ])("never throws and reports unknown for %s", async (_label, body) => {
    await expect(logMcpProtocolEra("public", request(), body)).resolves.toBeUndefined();
    expect(lastLine()).toContain("method=unknown");
  });
});
