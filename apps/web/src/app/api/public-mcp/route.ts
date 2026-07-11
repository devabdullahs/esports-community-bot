import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";
import { resolvePublicMcpAccess } from "@/lib/public-mcp-auth";
import { createPublicMcpServer } from "@/lib/public-mcp-tools";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard byte cap on JSON-RPC bodies. Tool arguments on this surface are tiny
// (slugs, search strings, pagination) — 64 KiB is generous headroom.
const MCP_MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const blocked = await resolvePublicMcpAccess(request);
  if (blocked) return blocked;

  // One bounded read; the parsed value is handed to the SDK transport so the
  // body is never buffered or parsed a second time.
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

  const server = createPublicMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request, { parsedBody: body.value });
}
