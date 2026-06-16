import "server-only";

import {
  createComment as _create,
  getComment as _get,
  listCommentsForPost as _list,
  editComment as _edit,
  setCommentStatus as _setStatus,
  autoApproveDueComments as _autoApprove,
  listCommentsForModeration as _listMod,
  countCommentsByStatus as _counts,
} from "@bot/db/postComments.js";
import {
  setPostLike as _setPostLike,
  removePostLike as _removePostLike,
  getPostLikeSummary as _postLikeSummary,
} from "@bot/db/postLikes.js";
import {
  setCommentLike as _setCommentLike,
  removeCommentLike as _removeCommentLike,
  getCommentLikeCounts as _commentLikeCounts,
  getViewerCommentLikes as _viewerCommentLikes,
  getCommentLikeSummary as _commentLikeSummary,
} from "@bot/db/commentLikes.js";
import { recordCommentModeration as _recordMod } from "@bot/db/commentModerationActions.js";
import { analyzeCommentText as _analyze } from "@bot/lib/commentModeration.js";
import type { CommentStatus } from "@/lib/comment-validation";

export type CommentRecord = {
  id: number;
  postId: number;
  parentCommentId: number | null;
  rootCommentId: number | null;
  authUserId: string;
  discordUserId: string;
  authorName: string;
  body: string;
  status: CommentStatus;
  flagReason: Record<string, unknown> | null;
  autoApproveAt: number | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
};

type CreateInput = {
  postId: number;
  parentCommentId?: number | null;
  authUserId: string;
  discordUserId: string;
  authorName?: string;
  body: string;
  status: CommentStatus;
  flagReason?: Record<string, unknown> | null;
  autoApproveAt?: number | null;
};

const createComment = _create as (i: CreateInput) => Promise<{ comment: CommentRecord } | { error: string }>;
const getComment = _get as (id: number) => Promise<CommentRecord | null>;
const listForPost = _list as (postId: number) => Promise<CommentRecord[]>;
const editComment = _edit as (
  id: number,
  patch: { body: string; status: CommentStatus; flagReason?: Record<string, unknown> | null; autoApproveAt?: number | null },
) => Promise<CommentRecord | null>;
const setCommentStatus = _setStatus as (
  id: number,
  status: CommentStatus,
  opts?: { deletedBy?: string | null },
) => Promise<CommentRecord | null>;
const autoApproveDue = _autoApprove as () => Promise<{ approved: number; ids: number[] }>;
const listMod = _listMod as (q: {
  status?: CommentStatus | null;
  flagged?: boolean;
  limit?: number;
  offset?: number;
}) => Promise<CommentRecord[]>;
const countsByStatus = _counts as () => Promise<Record<string, number>>;
const recordModeration = _recordMod as (i: {
  commentId: number;
  moderatorDiscordId: string;
  moderatorName?: string | null;
  action: string;
  reason?: string | null;
}) => Promise<void>;

const analyze = _analyze as (
  body: string,
) => { profanity: string[]; hasProfanity: boolean; links: string[]; externalLinks: string[]; hasExternalLinks: boolean };

function autoApproveHours(): number {
  const n = Number(process.env.COMMENT_AUTO_APPROVE_LINK_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/**
 * Decide a new/edited comment's status from its text:
 *  - profanity/slur  -> pending, never auto-approve (moderator must review).
 *  - external link    -> pending, auto-approve after COMMENT_AUTO_APPROVE_LINK_HOURS.
 *  - otherwise        -> visible.
 */
export function moderationFor(body: string): {
  status: CommentStatus;
  flagReason: Record<string, unknown> | null;
  autoApproveAt: number | null;
} {
  const a = analyze(body);
  if (a.hasProfanity) {
    return {
      status: "pending",
      flagReason: { profanity: a.profanity, ...(a.hasExternalLinks ? { links: a.externalLinks } : {}) },
      autoApproveAt: null,
    };
  }
  if (a.hasExternalLinks) {
    return {
      status: "pending",
      flagReason: { links: a.externalLinks },
      autoApproveAt: Math.floor(Date.now() / 1000) + Math.round(autoApproveHours() * 3600),
    };
  }
  return { status: "visible", flagReason: null, autoApproveAt: null };
}

// --- public (post-page) view ------------------------------------------------

export type PublicComment = {
  id: number;
  authorName: string;
  body: string;
  status: "visible" | "pending" | "deleted";
  createdAt: string;
  editedAt: string | null;
  likeCount: number;
  viewerLiked: boolean;
  isOwn: boolean;
  isDeleted: boolean;
  replies: PublicComment[];
};

function placeholder(c: CommentRecord): PublicComment {
  return {
    id: Number(c.id),
    authorName: "",
    body: "",
    status: "deleted",
    createdAt: c.createdAt,
    editedAt: null,
    likeCount: 0,
    viewerLiked: false,
    isOwn: false,
    isDeleted: true,
    replies: [],
  };
}

function toPublic(
  c: CommentRecord,
  viewer: string | null,
  counts: Record<number, number>,
  viewerLikes: Set<number>,
): PublicComment {
  const isDeleted = c.status === "deleted";
  return {
    id: Number(c.id),
    authorName: isDeleted ? "" : c.authorName,
    body: isDeleted ? "" : c.body,
    status: c.status as "visible" | "pending" | "deleted",
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    likeCount: counts[Number(c.id)] ?? 0,
    viewerLiked: viewerLikes.has(Number(c.id)),
    isOwn: Boolean(viewer) && c.discordUserId === viewer,
    isDeleted,
    replies: [],
  };
}

// A reply renders if visible, or pending and owned by the viewer.
function replyRenders(c: CommentRecord, viewer: string | null): boolean {
  if (c.status === "visible") return true;
  if (c.status === "pending") return Boolean(viewer) && c.discordUserId === viewer;
  return false;
}

/**
 * Build the threaded comment tree for a post as seen by `viewer`. Runs the lazy
 * auto-approval sweep first (no cron needed). Visibility:
 *  - visible -> shown to all
 *  - pending -> shown only to its author (with a pending badge client-side)
 *  - deleted / pending-not-yours root WITH replies -> placeholder so the thread holds
 */
export async function getPostCommentsView(
  postId: number,
  viewer: string | null,
): Promise<PublicComment[]> {
  await autoApproveDue().catch(() => {});
  const rows = await listForPost(postId);
  const ids = rows.map((c) => Number(c.id));
  const [counts, viewerLikes] = await Promise.all([
    (_commentLikeCounts as (ids: number[]) => Promise<Record<number, number>>)(ids),
    viewer
      ? (_viewerCommentLikes as (ids: number[], d: string) => Promise<Set<number>>)(ids, viewer)
      : Promise.resolve(new Set<number>()),
  ]);

  const repliesByRoot = new Map<number, CommentRecord[]>();
  for (const c of rows) {
    if (c.rootCommentId != null) {
      const key = Number(c.rootCommentId);
      if (!repliesByRoot.has(key)) repliesByRoot.set(key, []);
      repliesByRoot.get(key)!.push(c);
    }
  }

  const out: PublicComment[] = [];
  for (const root of rows.filter((c) => c.rootCommentId == null)) {
    const childPublic = (repliesByRoot.get(Number(root.id)) || [])
      .filter((r) => replyRenders(r, viewer))
      .map((r) => toPublic(r, viewer, counts, viewerLikes));
    const selfVisible =
      root.status === "visible" || (root.status === "pending" && Boolean(viewer) && root.discordUserId === viewer);

    if (!selfVisible && childPublic.length === 0) continue; // nothing to show
    const node = selfVisible ? toPublic(root, viewer, counts, viewerLikes) : placeholder(root);
    node.replies = childPublic;
    out.push(node);
  }
  return out;
}

// --- mutations + moderation -------------------------------------------------

export type CreateResult = { comment: CommentRecord } | { error: string };

export async function createPostComment(input: Omit<CreateInput, "status" | "flagReason" | "autoApproveAt">): Promise<CreateResult> {
  const mod = moderationFor(input.body);
  return createComment({ ...input, status: mod.status, flagReason: mod.flagReason, autoApproveAt: mod.autoApproveAt });
}

export async function editOwnComment(id: number, body: string): Promise<CommentRecord | null> {
  const mod = moderationFor(body);
  return editComment(id, { body, status: mod.status, flagReason: mod.flagReason, autoApproveAt: mod.autoApproveAt });
}

export function getCommentById(id: number): Promise<CommentRecord | null> {
  return getComment(id);
}

export function softDeleteComment(id: number, deletedByDiscordId: string): Promise<CommentRecord | null> {
  return setCommentStatus(id, "deleted", { deletedBy: deletedByDiscordId });
}

const ACTION_TO_STATUS: Record<string, CommentStatus> = {
  approve: "visible",
  reject: "rejected",
  hide: "hidden",
  restore: "visible",
  delete: "deleted",
};

export async function moderateComment(
  id: number,
  action: keyof typeof ACTION_TO_STATUS,
  moderator: { discordUserId: string; displayName: string | null },
  reason?: string | null,
): Promise<CommentRecord | null> {
  const status = ACTION_TO_STATUS[action];
  const updated = await setCommentStatus(id, status, {
    deletedBy: action === "delete" ? moderator.discordUserId : null,
  });
  if (!updated) return null;
  await recordModeration({
    commentId: id,
    moderatorDiscordId: moderator.discordUserId,
    moderatorName: moderator.displayName,
    action,
    reason: reason ?? null,
  });
  return updated;
}

// Sweep link-only pending comments whose timer has elapsed so the moderation
// queue and counts reflect them as visible instead of stale pending. This is the
// same sweep the public post view runs; exposed here so routes don't reach into
// the bot DB directly.
export async function autoApproveDueCommentsForModeration(): Promise<void> {
  await autoApproveDue().catch(() => {});
}

export function listModerationComments(
  filter: { status?: CommentStatus | null; flagged?: boolean },
  limit = 100,
  offset = 0,
): Promise<CommentRecord[]> {
  return listMod({ status: filter.status ?? null, flagged: filter.flagged ?? false, limit, offset });
}

export function commentStatusCounts(): Promise<Record<string, number>> {
  return countsByStatus();
}

// --- likes ------------------------------------------------------------------

export const setPostLike = _setPostLike as (postId: number, d: string) => Promise<{ liked: boolean; created: boolean }>;
export const removePostLike = _removePostLike as (postId: number, d: string) => Promise<{ liked: boolean; removed: boolean }>;
export const getPostLikeSummary = _postLikeSummary as (postId: number, d?: string | null) => Promise<{ count: number; liked: boolean }>;
export const setCommentLike = _setCommentLike as (commentId: number, d: string) => Promise<{ liked: boolean; created: boolean }>;
export const removeCommentLike = _removeCommentLike as (commentId: number, d: string) => Promise<{ liked: boolean; removed: boolean }>;
export const getCommentLikeSummary = _commentLikeSummary as (
  commentId: number,
  d?: string | null,
) => Promise<{ count: number; liked: boolean }>;
