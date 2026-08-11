import { createMcpHandler } from "@modelcontextprotocol/server";
import { NextResponse } from "next/server";
import { resolvePublicMcpAccess } from "@/lib/public-mcp-auth";
import { createPublicMcpServer } from "@/lib/public-mcp-tools";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard byte cap on JSON-RPC bodies. Tool arguments on this surface are tiny
// (slugs, search strings, pagination) — 64 KiB is generous headroom.
const MCP_MAX_BODY_BYTES = 64 * 1024;

// One dual-era handler for the process. `legacy: 'stateless'` is the SDK's
// default posture: 2026-07-28 traffic is served statelessly from the per-request
// factory, and 2025-era `initialize` clients keep working through the stateless
// legacy fallback (a fresh instance per request, `sessionIdGenerator: undefined`)
// — the same wiring this route had before, now owned by the SDK.
const mcpHandler = createMcpHandler(() => createPublicMcpServer(), {
  legacy: "stateless",
});

export async function POST(request: Request) {
  const blocked = await resolvePublicMcpAccess(request);
  if (blocked) return blocked;

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

  return mcpHandler.fetch(request, { parsedBody: body.value });
}
