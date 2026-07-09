import "server-only";

import { NextResponse } from "next/server";
import { consumeRateLimit } from "@bot/db/ewcRateLimits.js";
import {
  MCP_TOOL_NAMES,
  touchMcpKey,
  verifyMcpKeySecret,
} from "@bot/db/mcpKeys.js";
import { getAdmin } from "@/lib/admins";
import { ADMIN_ALWAYS_ON_MCP_TOOL_NAMES } from "@/lib/mcp-tool-manifest";

type McpKeyRow = Awaited<ReturnType<typeof verifyMcpKeySecret>>;

export const MCP_NO_SCOPE_SENTINEL = "__ec_no_scope__";
const ADMIN_ALWAYS_ON_MCP_TOOL_SET = new Set<string>(ADMIN_ALWAYS_ON_MCP_TOOL_NAMES);

export type McpAccess = {
  key: NonNullable<McpKeyRow>;
  discordUserId: string;
  displayName: string | null;
  isSuper: boolean;
  games: string[] | "ALL";
  media: string[] | "ALL";
  tools: Set<string>;
};

function parseIds(value: string | undefined): Set<string> {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function superAdminDiscordIds(): Set<string> {
  return new Set([
    ...parseIds(process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS),
    ...parseIds(process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS),
  ]);
}

function intersectScopes(owner: string[] | "ALL", keyScopes: string[]): string[] | "ALL" {
  if (keyScopes.includes(MCP_NO_SCOPE_SENTINEL)) return [];
  const cleanScopes = keyScopes.filter((scope) => scope !== MCP_NO_SCOPE_SENTINEL);
  if (!cleanScopes.length) return owner;
  if (owner === "ALL") return cleanScopes;
  const allowed = new Set(owner);
  return cleanScopes.filter((slug) => allowed.has(slug));
}

export function isMcpEnabled() {
  return process.env.EWC_MCP_ENABLED !== "false";
}

export function mcpAllowedOrigins(): Set<string> {
  return new Set(
    String(process.env.EWC_MCP_ALLOWED_ORIGINS || process.env.EWC_DASHBOARD_PUBLIC_URL || "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

export function mcpOriginOr403(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("host");
  const allowed = mcpAllowedOrigins();
  try {
    const normalized = new URL(origin).origin;
    if (host && new URL(origin).host === host) return null;
    if (allowed.has(normalized)) return null;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function resolveMcpAccess(request: Request): Promise<
  | { access: McpAccess }
  | { response: NextResponse }
> {
  if (!isMcpEnabled()) {
    return { response: NextResponse.json({ error: "MCP is disabled" }, { status: 404 }) };
  }

  const originBlocked = mcpOriginOr403(request);
  if (originBlocked) return { response: originBlocked };

  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { response: NextResponse.json({ error: "Missing MCP bearer key" }, { status: 401 }) };

  const key = await verifyMcpKeySecret(match[1].trim());
  if (!key) return { response: NextResponse.json({ error: "Invalid MCP bearer key" }, { status: 401 }) };

  const limited = await consumeRateLimit({
    key: `mcp:${key.id}`,
    limit: Math.max(10, Number(process.env.EWC_MCP_RATE_LIMIT_PER_MINUTE) || 60),
    windowSec: 60,
  }) as { allowed: boolean; retryAfterSec: number };
  if (!limited.allowed) {
    const retry = Math.max(1, limited.retryAfterSec);
    return {
      response: NextResponse.json(
        { error: `Too many requests - try again in ${retry} seconds.` },
        { status: 429, headers: { "Retry-After": String(retry) } },
      ),
    };
  }

  const ownerId = key.ownerDiscordId;
  const isSuper = superAdminDiscordIds().has(ownerId);
  const roster = isSuper ? null : await getAdmin(ownerId);
  if (!isSuper && (!roster || (roster.games.length === 0 && roster.media.length === 0))) {
    return { response: NextResponse.json({ error: "MCP key owner is no longer an admin" }, { status: 403 }) };
  }

  const ownerGames: string[] | "ALL" = isSuper ? "ALL" : roster!.games;
  const ownerMedia: string[] | "ALL" = isSuper ? "ALL" : roster!.media;
  const tools = new Set(key.tools.length ? key.tools : MCP_TOOL_NAMES);
  await touchMcpKey(key.id);

  return {
    access: {
      key,
      discordUserId: ownerId,
      displayName: key.ownerName || roster?.displayName || null,
      isSuper,
      games: intersectScopes(ownerGames, key.games),
      media: intersectScopes(ownerMedia, key.media),
      tools,
    },
  };
}

export function canUseMcpTool(access: McpAccess, tool: string) {
  return ADMIN_ALWAYS_ON_MCP_TOOL_SET.has(tool) || access.tools.has(tool);
}

export function canMcpManageGame(access: McpAccess, slug: string) {
  return access.games === "ALL" || access.games.includes(slug);
}

export function canMcpManageMedia(access: McpAccess, slug: string) {
  return access.media === "ALL" || access.media.includes(slug);
}

export function mcpAuditActor(access: McpAccess) {
  return {
    actorId: `mcp:${access.key.id}:${access.discordUserId}`,
    actorName: access.displayName ? `${access.displayName} (MCP)` : `MCP key ${access.key.keyPrefix}`,
  };
}
