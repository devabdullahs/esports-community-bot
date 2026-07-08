import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { listGames } from "@/lib/games";
import { listMediaChannels } from "@/lib/media";
import { createMcpKey, listMcpKeys, MCP_TOOL_NAMES } from "@/lib/mcp-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeList(input: unknown, valid: string[]) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(valid);
  return [...new Set(input.filter((value): value is string => typeof value === "string" && allowed.has(value)))];
}

function parseExpiry(input: unknown) {
  if (input == null || input === "") return null;
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export async function GET() {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  return NextResponse.json({ keys: await listMcpKeys(), tools: MCP_TOOL_NAMES });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const ownerDiscordId = access.discordUserId;
  if (!ownerDiscordId) {
    return NextResponse.json({ error: "Signed-in admin is missing a Discord ID" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 100) : "";
  const ownerName = access.displayName?.trim().slice(0, 100) || null;
  const games = sanitizeList(body.games, (await listGames()).map((game) => game.slug));
  const media = sanitizeList(body.media, (await listMediaChannels()).map((channel) => channel.slug));
  const tools = sanitizeList(body.tools, MCP_TOOL_NAMES);
  const created = await createMcpKey({
    label,
    ownerDiscordId,
    ownerName,
    tools: tools.length ? tools : MCP_TOOL_NAMES,
    games,
    media,
    expiresAt: parseExpiry(body.expiresAt),
    createdBy: access.discordUserId,
  });

  await recordAdminAudit(access, "mcp_key.create", String(created.key.id), {
    ownerDiscordId,
    keyPrefix: created.key.keyPrefix,
  });
  return NextResponse.json(created, { status: 201 });
}
