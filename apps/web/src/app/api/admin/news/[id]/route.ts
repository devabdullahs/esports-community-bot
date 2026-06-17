import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { canManageGame, canManageMedia, getAdminAccess, type AdminAccess } from "@/lib/admin";
import { resolveNewsAuthors } from "@/lib/authors";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { getGame } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { deleteNewsPost, getNewsPost, updateNewsPost } from "@/lib/news";
import { parsePostId, validateNewsInput } from "@/lib/news-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A post is managed by whoever manages its owner — the media channel for media
// posts, otherwise the game.
function canManagePost(
  access: AdminAccess,
  owner: { gameSlug?: string | null; mediaSlug?: string | null },
): boolean {
  if (owner.mediaSlug) return canManageMedia(access, owner.mediaSlug);
  if (owner.gameSlug) return canManageGame(access, owner.gameSlug);
  return false;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const postId = parsePostId(id);
  if (postId === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await getNewsPost(postId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const validated = validateNewsInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const v = validated.value;

  // Target owner must exist (media channel, or game; a media post's related game is optional).
  if (v.mediaSlug) {
    if (!(await getMediaChannel(v.mediaSlug))) {
      return NextResponse.json({ error: "Unknown media channel" }, { status: 400 });
    }
    if (v.gameSlug && !(await getGame(v.gameSlug))) {
      return NextResponse.json({ error: "Unknown game" }, { status: 400 });
    }
  } else if (!v.gameSlug || !(await getGame(v.gameSlug))) {
    return NextResponse.json({ error: "Unknown game" }, { status: 400 });
  }

  // Must manage the post's CURRENT owner (to edit it) AND the TARGET owner (to move it there).
  if (
    !canManagePost(access, { gameSlug: existing.gameSlug, mediaSlug: existing.mediaSlug }) ||
    !canManagePost(access, { gameSlug: v.gameSlug, mediaSlug: v.mediaSlug })
  ) {
    return NextResponse.json({ error: "You are not assigned to this post" }, { status: 403 });
  }

  // Server-authoritative authors: submitted ids must be eligible for the owner. With
  // nothing submitted, keep the post's existing primary author.
  const resolved = await resolveNewsAuthors({
    gameSlug: v.gameSlug,
    mediaSlug: v.mediaSlug,
    authors: v.authors,
    authorDiscordId: v.authorDiscordId,
    fallbackAuthor: { discordId: existing.authorDiscordId, name: existing.authorName },
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 403 });
  const updated = await updateNewsPost(postId, {
    ...v,
    authors: resolved.authors,
    authorDiscordId: resolved.authors[0]?.discordId ?? null,
    authorName: resolved.authors[0]?.name ?? null,
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-news", "default");
  recordAdminAudit(access, "news.update", String(postId));
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const postId = parsePostId(id);
  if (postId === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await getNewsPost(postId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManagePost(access, { gameSlug: existing.gameSlug, mediaSlug: existing.mediaSlug })) {
    return NextResponse.json({ error: "You are not assigned to this post" }, { status: 403 });
  }

  const result = await deleteNewsPost(postId);
  if (result.changes === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-news", "default");
  recordAdminAudit(access, "news.delete", String(postId));
  return NextResponse.json({ ok: true });
}
