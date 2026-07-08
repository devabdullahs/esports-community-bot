import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { getAdmin } from "@/lib/admins";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { listGames } from "@/lib/games";
import { listMediaChannels } from "@/lib/media";
import { createMcpKey, listMcpKeys, MCP_TOOL_NAMES } from "@/lib/mcp-keys";
import { isSnowflake } from "@/lib/validate";

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

function parseIds(value: string | undefined): Set<string> {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function isOwnerSuperAdmin(discordId: string) {
  return (
    parseIds(process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS).has(discordId) ||
    parseIds(process.env.EWC_DASHBOARD_ADMIN_DISCORD_IDS).has(discordId)
  );
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
  const ownerDiscordId = typeof body.ownerDiscordId === "string" ? body.ownerDiscordId.trim() : "";
  if (!isSnowflake(ownerDiscordId)) {
    return NextResponse.json({ error: "Owner Discord ID must be a 17-20 digit snowflake" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 100) : "";
  const ownerNameInput = typeof body.ownerName === "string" ? body.ownerName.trim().slice(0, 100) : "";
  const rosterOwner = await getAdmin(ownerDiscordId).catch(() => null);
  if (!isOwnerSuperAdmin(ownerDiscordId) && !rosterOwner) {
    return NextResponse.json({ error: "Owner must already be a dashboard admin" }, { status: 400 });
  }
  const ownerName = ownerNameInput || rosterOwner?.displayName || null;
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
