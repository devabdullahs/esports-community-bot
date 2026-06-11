import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { createGame, getGame, listGames } from "@/lib/games";
import { normalizeSlug, validateGameContent } from "@/lib/game-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ games: listGames() });
}

export async function POST(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const slug = normalizeSlug(typeof body.slug === "string" ? body.slug : "");
  if (!slug) return NextResponse.json({ error: "A URL slug is required" }, { status: 400 });
  if (getGame(slug)) {
    return NextResponse.json({ error: `A game with the slug "${slug}" already exists` }, { status: 409 });
  }

  const validated = validateGameContent(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const game = createGame({ slug, ...validated.value });
  revalidateTag("cms-games", "default");
  recordAdminAudit(access, "game.create", slug);
  return NextResponse.json(game);
}
