import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { getNewsPost, setNewsPostStatus } from "@/lib/news";
import { indexNowUrlsForPost, scheduleIndexNowUrls } from "@/lib/indexnow";
import { parsePostId } from "@/lib/news-validation";
import { validateNewsContentInput } from "@bot/lib/ewcNewsContent.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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

  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (status !== "draft" && status !== "published") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const existing = await getNewsPost(postId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const canManage = existing.mediaSlug
    ? canManageMedia(access, existing.mediaSlug)
    : existing.gameSlug
      ? canManageGame(access, existing.gameSlug)
      : false;
  if (!canManage) {
    return NextResponse.json({ error: "You are not assigned to this post" }, { status: 403 });
  }
  if (status === "published") {
    const validated = validateNewsContentInput({ ...existing, status });
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const post = await setNewsPostStatus(postId, status);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-news", { expire: 0 });
  recordAdminAudit(access, "news.status", String(postId), { status });
  scheduleIndexNowUrls([
      ...indexNowUrlsForPost(existing),
      ...indexNowUrlsForPost(post),
  ]);
  return NextResponse.json(post);
}
