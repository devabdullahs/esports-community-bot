import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { canManageGame, getAdminAccess, isSuper } from "@/lib/admin";
import { deleteGame, updateGame } from "@/lib/games";
import { validateGameContent } from "@/lib/game-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await context.params;
  if (!canManageGame(access, slug)) {
    return NextResponse.json({ error: "You are not assigned to this game" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const validated = validateGameContent(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const updated = updateGame(slug, validated.value);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-games", "default");
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { slug } = await context.params;
  const result = deleteGame(slug);
  if (result.gameDeleted === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-games", "default");
  revalidateTag("cms-news", "default");
  return NextResponse.json({ ok: true, postsDeleted: result.postsDeleted });
}
