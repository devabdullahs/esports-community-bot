import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import {
  getAdmin,
  listAdmins,
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

export async function GET() {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  return NextResponse.json({ admins: await listAdmins() });
}

export async function POST(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const discordId = typeof body.discordId === "string" ? body.discordId.trim() : "";
  if (!isSnowflake(discordId)) {
    return NextResponse.json({ error: "Discord ID must be a 17-20 digit snowflake" }, { status: 400 });
  }
  const rawDisplayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (rawDisplayName.length > 100) {
    return NextResponse.json({ error: "Display name must be 100 characters or fewer" }, { status: 400 });
  }
  const displayName = rawDisplayName;

  const games = sanitizeScopes(body.games, (await listGames()).map((g) => g.slug));
  const media = sanitizeScopes(body.media, (await listMediaChannels()).map((c) => c.slug));

  await upsertAdmin({ discordId, displayName });
  await setAdminGameScopes(discordId, games);
  await setAdminMediaScopes(discordId, media);
  await recordAdminAudit(access, "team.upsert", discordId);
  return NextResponse.json(await getAdmin(discordId));
}
