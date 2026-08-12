import { createMcpHandler } from "@modelcontextprotocol/server";
import { NextResponse } from "next/server";
import type { McpAccess } from "@/lib/mcp-auth";
import { resolveMcpAccess } from "@/lib/mcp-auth";
import { logMcpProtocolEra } from "@/lib/mcp-era-log";
import { createAdminMcpServer } from "@/lib/mcp-tools";
import { readBoundedJson } from "@/lib/request-body";
import { timed } from "@/lib/request-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard byte cap on JSON-RPC bodies. The largest legitimate payload is a
// create_news_draft body (12k chars max) — 64 KiB is generous headroom.
const MCP_MAX_BODY_BYTES = 64 * 1024;

// This route resolves and verifies the bearer key itself, then hands the result
// down as `authInfo.extra` — the SDK's documented pass-through channel, which it
// never populates from headers on its own. The raw secret is deliberately not
// carried here; the key id is enough to identify the caller in a trace.
function accessFromContext(authInfo: { extra?: Record<string, unknown> } | undefined) {
  const access = authInfo?.extra?.access;
  if (!access) throw new Error("MCP handler invoked without resolved admin access.");
  return access as McpAccess;
}

// One dual-era handler for the process. `legacy: 'stateless'` is the SDK's
// default posture: 2026-07-28 traffic is served statelessly from the per-request
// factory, and 2025-era `initialize` clients keep working through the stateless
// legacy fallback — the same wiring this route had before, now owned by the SDK.
const mcpHandler = createMcpHandler((ctx) => createAdminMcpServer(accessFromContext(ctx.authInfo)), {
  legacy: "stateless",
});

// Same split as the public route: measured from outside, an MCP POST cannot be
// attributed to admission (key verification plus the rate-limit write) or to
// the MCP work itself.
const MCP_PHASE_SLOW_MS = Number(process.env.EWC_MCP_SLOW_PHASE_MS || 400);

export async function POST(request: Request) {
  const resolved = await timed(
    "mcp.admin.admission",
    () => resolveMcpAccess(request),
    MCP_PHASE_SLOW_MS,
  );
  if ("response" in resolved) return resolved.response;

  // One bounded read; the parsed value is handed to the handler so the body is
  // never buffered or parsed a second time.
  const body = await readBoundedJson(request, MCP_MAX_BODY_BYTES);
  if (!body.ok) {
    if (body.reason === "too_large") {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (Array.isArray(body.value)) {
    return NextResponse.json({ error: "MCP JSON-RPC batching is not supported." }, { status: 400 });
  }

  // Records which era answered, so the dated removal of the 2025 handshake can
  // be decided from traffic rather than assumed.
  await logMcpProtocolEra("admin", request, body.value);

  return timed(
    "mcp.admin.dispatch",
    () =>
      mcpHandler.fetch(request, {
        parsedBody: body.value,
        authInfo: {
          token: String(resolved.access.key.id),
          clientId: resolved.access.discordUserId,
          scopes: [...resolved.access.tools],
          extra: { access: resolved.access },
        },
      }),
    MCP_PHASE_SLOW_MS,
  );
}
