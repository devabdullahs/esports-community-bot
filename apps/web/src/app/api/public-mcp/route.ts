import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";
import { resolvePublicMcpAccess } from "@/lib/public-mcp-auth";
import { createPublicMcpServer } from "@/lib/public-mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function rejectBatchRequest(request: Request) {
  const body = await request.clone().json().catch(() => null);
  if (!Array.isArray(body)) return null;
  return NextResponse.json({ error: "MCP JSON-RPC batching is not supported." }, { status: 400 });
}

export async function POST(request: Request) {
  const blocked = await resolvePublicMcpAccess(request);
  if (blocked) return blocked;

  const batchBlocked = await rejectBatchRequest(request);
  if (batchBlocked) return batchBlocked;

  const server = createPublicMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}
