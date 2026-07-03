import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  autoApproveDueCommentsForModeration,
  commentStatusCounts,
  listModerationComments,
  listReportedModerationComments,
  reportCountsForComments,
  reportedCommentsCount,
} from "@/lib/comments";
import { parseStatusFilter } from "@/lib/comment-validation";
import { getNewsPost } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moderation queue. Any allowed admin is a moderator and may act on ANY comment.
export async function GET(request: Request) {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const filterParam = params.get("status");

  // Flip due link-only pending comments to visible first, so the queue and counts
  // don't show stale pending entries that should already be approved.
  await autoApproveDueCommentsForModeration();
  const [comments, counts, reported] = await Promise.all([
    filterParam === "reported"
      ? listReportedModerationComments()
      : listModerationComments(filterParam === "flagged" ? { flagged: true } : { status: parseStatusFilter(filterParam) }),
    commentStatusCounts(),
    reportedCommentsCount(),
  ]);

  // Open report counts for the listed comments (already present on the reported
  // list; fetched for the other filters so every row can show its report badge).
  const reportCounts =
    filterParam === "reported"
      ? Object.fromEntries(
          comments.map((c) => [Number(c.id), Number((c as { reportOpenCount?: number }).reportOpenCount ?? 0)]),
        )
      : await reportCountsForComments(comments.map((c) => Number(c.id)));

  // Resolve post titles once per unique post (small page size).
  const titles = new Map<number, string>();
  for (const postId of new Set(comments.map((c) => Number(c.postId)))) {
    const post = await getNewsPost(postId);
    if (post) titles.set(postId, post.title);
  }

  return NextResponse.json({
    counts: { ...counts, reported },
    comments: comments.map((c) => ({
      id: Number(c.id),
      postId: Number(c.postId),
      postTitle: titles.get(Number(c.postId)) ?? null,
      parentCommentId: c.parentCommentId == null ? null : Number(c.parentCommentId),
      authorName: c.authorName,
      authorAvatarUrl: c.authorAvatarUrl,
      discordUserId: c.discordUserId,
      body: c.body,
      status: c.status,
      flagReason: c.flagReason,
      reportCount: reportCounts[Number(c.id)] ?? 0,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      deletedBy: c.deletedBy,
    })),
  });
}
