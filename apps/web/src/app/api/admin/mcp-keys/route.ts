import { NextResponse } from "next/server";
import { getAdminAccess, type AdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { listGames } from "@/lib/games";
import { listMediaChannels } from "@/lib/media";
import { MCP_NO_SCOPE_SENTINEL } from "@/lib/mcp-auth";
import { ADMIN_SELECTABLE_MCP_TOOL_NAMES } from "@/lib/mcp-tool-manifest";
import { createMcpKey, listMcpKeys, toMcpKeyDto, type McpKey } from "@/lib/mcp-keys";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeList(input: unknown, valid: readonly string[]) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(valid);
  return [...new Set(input.filter((value): value is string => typeof value === "string" && allowed.has(value)))];
}

function parseExpiry(input: unknown) {
  if (input == null || input === "") return null;
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function keysVisibleTo(access: AdminAccess, keys: Awaited<ReturnType<typeof listMcpKeys>>) {
  if (access.isSuper) return keys;
  return keys.filter((key) => key.ownerDiscordId === access.discordUserId);
}

function allowedScopes(access: AdminAccess, valid: string[], kind: "games" | "media") {
  const scopes = kind === "games" ? access.games : access.media;
  if (scopes === "ALL") return valid;
  return scopes;
}

function storedScopes(selected: string[], allowed: string[]) {
  if (selected.length > 0) return selected;
  return allowed.length > 0 ? [MCP_NO_SCOPE_SENTINEL] : [];
}

function publicKey(key: McpKey) {
  const dto = toMcpKeyDto(key);
  return {
    id: dto.id,
    keyPrefix: dto.keyPrefix,
    label: dto.label,
    ownerDiscordId: dto.ownerDiscordId,
    ownerName: dto.ownerName,
    tools: dto.tools,
    games: dto.games.filter((scope) => scope !== MCP_NO_SCOPE_SENTINEL),
    media: dto.media.filter((scope) => scope !== MCP_NO_SCOPE_SENTINEL),
    expiresAt: dto.expiresAt,
    revokedAt: dto.revokedAt,
    lastUsedAt: dto.lastUsedAt,
    createdBy: dto.createdBy,
    createdAt: dto.createdAt,
  };
}

export async function GET() {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const keys = keysVisibleTo(access, await listMcpKeys()).map(publicKey);
  return NextResponse.json({ keys, tools: ADMIN_SELECTABLE_MCP_TOOL_NAMES });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const ownerDiscordId = access.discordUserId;
  if (!ownerDiscordId) {
    return NextResponse.json({ error: "Signed-in admin is missing a Discord ID" }, { status: 400 });
  }

  const limited = await rateLimitOr429({
    key: `admin:mcp-key:create:${ownerDiscordId}`,
    limit: 10,
    windowSec: 600,
  });
  if (limited) return limited;

  const expiresAt = parseExpiry(body.expiresAt);
  if (expiresAt !== null && expiresAt <= Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "Expiry must be in the future" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 100) : "";
  const ownerName = access.displayName?.trim().slice(0, 100) || null;
  const [allGames, allMedia] = await Promise.all([listGames(), listMediaChannels()]);
  const allowedGames = allowedScopes(access, allGames.map((game) => game.slug), "games");
  const allowedMedia = allowedScopes(access, allMedia.map((channel) => channel.slug), "media");
  const games = sanitizeList(body.games, allowedGames);
  const media = sanitizeList(body.media, allowedMedia);
  const tools = sanitizeList(body.tools, ADMIN_SELECTABLE_MCP_TOOL_NAMES);
  if (tools.length === 0) {
    return NextResponse.json({ error: "Select at least one MCP tool" }, { status: 400 });
  }
  const created = await createMcpKey({
    label,
    ownerDiscordId,
    ownerName,
    tools,
    games: storedScopes(games, allowedGames),
    media: storedScopes(media, allowedMedia),
    expiresAt,
    createdBy: access.discordUserId,
  });

  await recordAdminAudit(access, "mcp_key.create", String(created.key.id), {
    ownerDiscordId,
    keyPrefix: created.key.keyPrefix,
    tools,
    games,
    media,
  });
  return NextResponse.json({ key: publicKey(created.key), secret: created.secret }, { status: 201 });
}
