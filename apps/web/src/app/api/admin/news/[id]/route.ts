import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { getGame } from "@/lib/games";
import { deleteNewsPost, getNewsPost, updateNewsPost } from "@/lib/news";
import { parsePostId, validateNewsInput } from "@/lib/news-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const postId = parsePostId(id);
  if (postId === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = getNewsPost(postId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const validated = validateNewsInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (!getGame(validated.value.gameSlug)) {
    return NextResponse.json({ error: "Unknown game" }, { status: 400 });
  }
  // Must own the post's CURRENT game (to edit it) AND the TARGET game (to move it there).
  if (!canManageGame(access, existing.gameSlug) || !canManageGame(access, validated.value.gameSlug)) {
    return NextResponse.json({ error: "You are not assigned to this game" }, { status: 403 });
  }

  // The editor's Author picker chooses who is credited; fall back to the post's
  // existing author when the payload omits it (COALESCE in the DB layer no-ops on null).
  const updated = updateNewsPost(postId, {
    ...validated.value,
    authorDiscordId: validated.value.authorDiscordId ?? null,
    authorName: validated.value.authorName ?? null,
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-news", "default");
  recordAdminAudit(access, "news.update", String(postId));
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const postId = parsePostId(id);
  if (postId === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = getNewsPost(postId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageGame(access, existing.gameSlug)) {
    return NextResponse.json({ error: "You are not assigned to this game" }, { status: 403 });
  }

  const result = deleteNewsPost(postId);
  if (result.changes === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-news", "default");
  recordAdminAudit(access, "news.delete", String(postId));
  return NextResponse.json({ ok: true });
}
