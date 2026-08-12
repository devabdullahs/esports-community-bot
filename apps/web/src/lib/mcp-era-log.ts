import "server-only";

import { isLegacyRequest } from "@modelcontextprotocol/server";
import { logger } from "@bot/lib/logger.js";

// Temporary instrumentation for the 2025-era deprecation.
//
// Nothing measures which protocol era answers an MCP request today, so the
// decision to flip `legacy: 'reject'` would otherwise be a guess against real
// integrations. One line per request gives the numerator and the denominator.
// Remove this together with the legacy era itself.

// The method name comes off an untrusted body and goes into a shared log
// stream, so it is bounded and stripped of anything that could forge a line.
const METHOD_SAFE = /[^a-zA-Z0-9/._-]/g;

function safeMethod(parsedBody: unknown) {
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return "unknown";
  }
  const method = (parsedBody as Record<string, unknown>).method;
  if (typeof method !== "string" || method.length === 0) return "unknown";
  return method.slice(0, 40).replace(METHOD_SAFE, "") || "unknown";
}

export async function logMcpProtocolEra(
  surface: "public" | "admin",
  request: Request,
  parsedBody: unknown,
) {
  try {
    // Same predicate the handler routes on, so the log cannot disagree with
    // what actually served the request.
    const legacy = await isLegacyRequest(request, parsedBody);
    logger.info(
      `[mcp] ${surface} era=${legacy ? "legacy" : "modern"} method=${safeMethod(parsedBody)}`,
    );
  } catch {
    // Instrumentation must never fail a request it is only observing.
  }
}
