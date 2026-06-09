import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { getNewsPost, setNewsPostStatus } from "@/lib/news";
import { parsePostId } from "@/lib/news-validation";
import { validateNewsContentInput } from "@bot/lib/ewcNewsContent.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, allowed } = await getAdminAccess();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const postId = parsePostId(id);
  if (postId === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (status !== "draft" && status !== "published") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const existing = getNewsPost(postId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (status === "published") {
    const validated = validateNewsContentInput({ ...existing, status });
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const post = setNewsPostStatus(postId, status);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(post);
}
