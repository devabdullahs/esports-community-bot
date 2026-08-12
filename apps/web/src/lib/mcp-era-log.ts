import "server-only";

import { isLegacyRequest } from "@modelcontextprotocol/server";
import { logger } from "@bot/lib/logger.js";
import { MCP_PROBE_USER_AGENT } from "@bot/lib/mcpProbeAgent.js";

// Temporary instrumentation for the 2025-era deprecation.
//
// Nothing measures which protocol era answers an MCP request today, so the
// decision to flip `legacy: 'reject'` would otherwise be a guess against real
// integrations. One line per request gives the numerator and the denominator.
// Remove this together with the legacy era itself.

// Method names, client names and header values all come off untrusted input and
// go into a log stream the bot also writes to, so each is bounded and stripped
// of anything that could forge a line.
const FIELD_SAFE = /[^a-zA-Z0-9/._@ -]/g;

function safeField(value: unknown, fallback: string, max = 40) {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value.slice(0, max).replace(FIELD_SAFE, "").trim() || fallback;
}

function record(parsedBody: unknown): Record<string, unknown> | null {
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) return null;
  return parsedBody as Record<string, unknown>;
}

function safeMethod(parsedBody: unknown) {
  return safeField(record(parsedBody)?.method, "unknown");
}

// The revision carries client identity in `_meta`; a handshake client instead
// declares it once, in the params of `initialize`. Read whichever is present so
// the two eras are comparable rather than only one being attributable.
function safeClient(parsedBody: unknown) {
  const params = record(record(parsedBody)?.params);
  if (!params) return "-";

  const meta = record(params._meta);
  const modern = record(meta?.["io.modelcontextprotocol/clientInfo"]);
  if (modern) return safeField(modern.name, "-");

  const legacy = record(params.clientInfo);
  if (legacy) return safeField(legacy.name, "-");

  return "-";
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
    // Our own smoke check sends one handshake-era request per run, which would
    // otherwise read as a real client refusing to migrate.
    const probe = request.headers.get("user-agent") === MCP_PROBE_USER_AGENT;

    logger.info(
      `[mcp] ${surface} era=${legacy ? "legacy" : "modern"}` +
        ` method=${safeMethod(parsedBody)} client=${safeClient(parsedBody)}` +
        `${probe ? " probe=self" : ""}`,
    );
  } catch {
    // Instrumentation must never fail a request it is only observing.
  }
}
