import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { listEligibleAuthors } from "@/lib/authors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the Discord users eligible to be credited as the author of a post for
// the given game. Admin-gated (any allowed admin may read it) — used by the news
// editor's Author picker.
export async function GET(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const game = new URL(request.url).searchParams.get("game");
  if (!game) return NextResponse.json({ error: "Game is required" }, { status: 400 });

  return NextResponse.json({ authors: listEligibleAuthors(game) });
}
