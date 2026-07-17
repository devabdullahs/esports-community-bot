import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { resolveNewsAuthors } from "@/lib/authors";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { getGame } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { indexNowUrlsForPost, scheduleIndexNowUrls } from "@/lib/indexnow";
import { createNewsPost, listAdminNewsPosts, type NewsStatus } from "@/lib/news";
import { validateNewsInput } from "@/lib/news-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const gameSlug = url.searchParams.get("game");
  const mediaSlug = url.searchParams.get("media");
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam === "draft" || statusParam === "scheduled" || statusParam === "published"
      ? (statusParam as NewsStatus)
      : null;

  const posts = await listAdminNewsPosts({ gameSlug, mediaSlug, status });
  // Scope: an admin sees a post if they manage its owner (game or media channel).
  const scoped = posts.filter((p) =>
    p.mediaSlug
      ? canManageMedia(access, p.mediaSlug)
      : p.gameSlug
        ? canManageGame(access, p.gameSlug)
        : false,
  );
  return NextResponse.json({ posts: scoped });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const validated = validateNewsInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const v = validated.value;

  // Ownership + RBAC: a media post is gated by canManageMedia; a game post by
  // canManageGame. A media post may carry an optional related game (must exist).
  if (v.mediaSlug) {
    if (!(await getMediaChannel(v.mediaSlug))) {
      return NextResponse.json({ error: "Unknown media channel" }, { status: 400 });
    }
    if (!canManageMedia(access, v.mediaSlug)) {
      return NextResponse.json({ error: "You are not assigned to this channel" }, { status: 403 });
    }
    if (v.gameSlug && !(await getGame(v.gameSlug))) {
      return NextResponse.json({ error: "Unknown game" }, { status: 400 });
    }
  } else {
    if (!v.gameSlug || !(await getGame(v.gameSlug))) {
      return NextResponse.json({ error: "Unknown game" }, { status: 400 });
    }
    if (!canManageGame(access, v.gameSlug)) {
      return NextResponse.json({ error: "You are not assigned to this game" }, { status: 403 });
    }
  }

  // Server-authoritative authors: submitted ids must be eligible for the owner
  // (no spoofing); stored name/avatar come from the eligible list. With nothing
  // submitted, fall back to the acting admin.
  const resolved = await resolveNewsAuthors({
    gameSlug: v.gameSlug,
    mediaSlug: v.mediaSlug,
    authors: v.authors,
    authorDiscordId: v.authorDiscordId,
    fallbackAuthor: { discordId: access.discordUserId, name: access.displayName },
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 403 });
  const post = await createNewsPost({
    ...validated.value,
    authors: resolved.authors,
    authorDiscordId: resolved.authors[0]?.discordId ?? null,
    authorName: resolved.authors[0]?.name ?? null,
  });
  revalidateTag("cms-news", { expire: 0 });
  recordAdminAudit(access, "news.create", String((post as { id: number }).id), {
    status: v.status ?? "draft",
    scheduledPublishAt: v.scheduledPublishAt,
  });
  scheduleIndexNowUrls(indexNowUrlsForPost(post));
  return NextResponse.json(post);
}
