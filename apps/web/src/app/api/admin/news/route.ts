import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { createNewsPost, listAdminNewsPosts, type NewsStatus } from "@/lib/news";
import { validateNewsInput } from "@/lib/news-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session, allowed } = await getAdminAccess();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const gameSlug = url.searchParams.get("game");
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam === "draft" || statusParam === "published" ? (statusParam as NewsStatus) : null;

  return NextResponse.json({ posts: listAdminNewsPosts({ gameSlug, status }) });
}

export async function POST(request: Request) {
  const { session, allowed, discordUserId } = await getAdminAccess();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const validated = validateNewsInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const post = createNewsPost({ ...validated.value, authorDiscordId: discordUserId ?? null });
  return NextResponse.json(post);
}
