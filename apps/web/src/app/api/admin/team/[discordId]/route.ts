import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import {
  deleteAdmin,
  getAdmin,
  setAdminGameScopes,
  setAdminMediaScopes,
  upsertAdmin,
} from "@/lib/admins";
import { listGames } from "@/lib/games";
import { listMediaChannels } from "@/lib/media";
import { isSnowflake } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeScopes(input: unknown, valid: string[]): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(valid);
  return [...new Set(input.filter((s): s is string => typeof s === "string" && allowed.has(s)))];
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ discordId: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { discordId } = await context.params;
  if (!isSnowflake(discordId)) {
    return NextResponse.json({ error: "Discord ID must be a 17-20 digit snowflake" }, { status: 400 });
  }
  if (!getAdmin(discordId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const rawDisplayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (rawDisplayName.length > 100) {
    return NextResponse.json({ error: "Display name must be 100 characters or fewer" }, { status: 400 });
  }
  const displayName = rawDisplayName;
  const games = sanitizeScopes(body.games, listGames().map((g) => g.slug));
  const media = sanitizeScopes(body.media, listMediaChannels().map((c) => c.slug));

  upsertAdmin({ discordId, displayName });
  setAdminGameScopes(discordId, games);
  setAdminMediaScopes(discordId, media);
  return NextResponse.json(getAdmin(discordId));
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ discordId: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { discordId } = await context.params;
  const result = deleteAdmin(discordId);
  if (result.deleted === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
