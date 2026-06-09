import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import {
  getAdmin,
  listAdmins,
  setAdminGameScopes,
  setAdminMediaScopes,
  upsertAdmin,
} from "@/lib/admins";
import { listGames } from "@/lib/games";
import { listMediaChannels } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeScopes(input: unknown, valid: string[]): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(valid);
  return [...new Set(input.filter((s): s is string => typeof s === "string" && allowed.has(s)))];
}

export async function GET() {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  return NextResponse.json({ admins: listAdmins() });
}

export async function POST(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const discordId = typeof body.discordId === "string" ? body.discordId.trim() : "";
  if (!discordId) return NextResponse.json({ error: "Discord ID is required" }, { status: 400 });
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

  const games = sanitizeScopes(body.games, listGames().map((g) => g.slug));
  const media = sanitizeScopes(body.media, listMediaChannels().map((c) => c.slug));

  upsertAdmin({ discordId, displayName });
  setAdminGameScopes(discordId, games);
  setAdminMediaScopes(discordId, media);
  return NextResponse.json(getAdmin(discordId));
}
