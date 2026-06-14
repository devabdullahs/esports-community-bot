import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { resolveNewsAuthors } from "@/lib/authors";
import { recordAdminAudit } from "@/lib/audit";
import { getGame } from "@/lib/games";
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
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam === "draft" || statusParam === "published" ? (statusParam as NewsStatus) : null;

  const posts = await listAdminNewsPosts({ gameSlug, status });
  // Scope: regular admins only see posts for their assigned games.
  const scoped =
    access.games === "ALL" ? posts : posts.filter((p) => access.games.includes(p.gameSlug));
  return NextResponse.json({ posts: scoped });
}

export async function POST(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const validated = validateNewsInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (!(await getGame(validated.value.gameSlug))) {
    return NextResponse.json({ error: "Unknown game" }, { status: 400 });
  }
  if (!canManageGame(access, validated.value.gameSlug)) {
    return NextResponse.json({ error: "You are not assigned to this game" }, { status: 403 });
  }

  // Server-authoritative authors: submitted ids must be eligible for this game
  // (no spoofing); the stored name/avatar come from the eligible list. With nothing
  // submitted, fall back to the acting admin.
  const resolved = await resolveNewsAuthors({
    gameSlug: validated.value.gameSlug,
    authors: validated.value.authors,
    authorDiscordId: validated.value.authorDiscordId,
    fallbackAuthor: { discordId: access.discordUserId, name: access.displayName },
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 403 });
  const post = await createNewsPost({
    ...validated.value,
    authors: resolved.authors,
    authorDiscordId: resolved.authors[0]?.discordId ?? null,
    authorName: resolved.authors[0]?.name ?? null,
  });
  revalidateTag("cms-news", "default");
  recordAdminAudit(access, "news.create", String((post as { id: number }).id));
  return NextResponse.json(post);
}
