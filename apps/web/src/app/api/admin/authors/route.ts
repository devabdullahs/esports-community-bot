import { NextResponse } from "next/server";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { listEligibleAuthors, listEligibleMediaAuthors } from "@/lib/authors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the Discord users eligible to be credited as the author of a post for
// the given game OR media channel. Admin-gated and scope-checked — used by the
// news editor's Author picker.
export async function GET(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const media = params.get("media");
  if (media) {
    if (!canManageMedia(access, media)) {
      return NextResponse.json({ error: "You are not assigned to this channel." }, { status: 403 });
    }
    return NextResponse.json({ authors: await listEligibleMediaAuthors(media) });
  }

  const game = params.get("game");
  if (!game) return NextResponse.json({ error: "Game is required" }, { status: 400 });
  // Game-scope the picker like the other admin news routes: a scoped admin may
  // only enumerate eligible authors for games they manage.
  if (!canManageGame(access, game)) {
    return NextResponse.json({ error: "You are not assigned to this game." }, { status: 403 });
  }

  return NextResponse.json({ authors: await listEligibleAuthors(game) });
}
