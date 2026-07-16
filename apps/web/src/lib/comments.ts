import "server-only";

import {
  createComment as _create,
  getComment as _get,
  listCommentsForTarget as _listTarget,
  editComment as _edit,
  setCommentStatus as _setStatus,
  autoApproveDueComments as _autoApprove,
  listCommentsForModeration as _listMod,
  countCommentsByStatus as _counts,
  holdVisibleCommentForReports as _holdVisible,
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
import {
  createCommentReport as _createReport,
  countCommentsWithOpenReports as _countReported,
  listReportedComments as _listReported,
  openReportCountsForComments as _openReportCounts,
  resolveReportsForComment as _resolveReports,
} from "@bot/db/commentReports.js";
import { analyzeCommentText as _analyze } from "@bot/lib/commentModeration.js";
import { authDatabase, isPostgresAuthDatabase } from "@/lib/auth-database";
import type { CommentReportReason, CommentStatus } from "@/lib/comment-validation";

export type CommentRecord = {
  id: number;
  postId: number | null;
  targetType: "news" | "match";
  targetId: number;
  parentCommentId: number | null;
  rootCommentId: number | null;
  authUserId: string;
  discordUserId: string;
  authorName: string;
  authorAvatarUrl: string | null;
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
  postId?: number;
  targetType?: "news" | "match";
  targetId?: number;
  parentCommentId?: number | null;
  authUserId: string;
  discordUserId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  body: string;
  status: CommentStatus;
  flagReason?: Record<string, unknown> | null;
  autoApproveAt?: number | null;
};

const createComment = _create as (i: CreateInput) => Promise<{ comment: CommentRecord } | { error: string }>;
const getComment = _get as (id: number) => Promise<CommentRecord | null>;
const listForTarget = _listTarget as (
  targetType: "news" | "match",
  targetId: number,
  limit?: number,
  opts?: { includeAllStatuses?: boolean },
) => Promise<CommentRecord[]>;
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
const holdVisibleForReports = _holdVisible as (id: number) => Promise<boolean>;
const recordModeration = _recordMod as (i: {
  commentId: number;
  moderatorDiscordId: string;
  moderatorName?: string | null;
  action: string;
  reason?: string | null;
}) => Promise<void>;
const createReport = _createReport as (i: {
  commentId: number;
  reporterDiscordId: string;
  reporterAuthUserId?: string | null;
  reason: CommentReportReason;
  detail?: string;
}) => Promise<{ created: boolean; openCount: number }>;
const openReportCounts = _openReportCounts as (ids: number[]) => Promise<Record<number, number>>;
const resolveReports = _resolveReports as (
  commentId: number,
  status?: string,
) => Promise<{ updated: number }>;
const listReported = _listReported as (q: {
  limit?: number;
  offset?: number;
}) => Promise<(CommentRecord & { reportOpenCount: number })[]>;
const countReported = _countReported as () => Promise<number>;

const analyze = _analyze as (
  body: string,
) => {
  profanity: string[];
  hasProfanity: boolean;
  reviewTerms: string[];
  hasReviewTerms: boolean;
  links: string[];
  externalLinks: string[];
  hasExternalLinks: boolean;
  needsReview: boolean;
};

type AuthUserAvatarRow = { id: string; image: string | null };
type PgAuthDatabase = { query: (sql: string, params: unknown[]) => Promise<{ rows: AuthUserAvatarRow[] }> };
type SqliteAuthDatabase = { prepare: (sql: string) => { all: (...params: string[]) => AuthUserAvatarRow[] } };

async function fillMissingAuthorAvatars(rows: CommentRecord[]): Promise<CommentRecord[]> {
  const ids = Array.from(
    new Set(rows.filter((c) => !c.authorAvatarUrl && c.authUserId).map((c) => c.authUserId)),
  );
  if (!ids.length) return rows;

  try {
    const authRows = isPostgresAuthDatabase()
      ? (await (authDatabase as PgAuthDatabase).query(
          'SELECT id, image FROM "user" WHERE id = ANY($1)',
          [ids],
        )).rows
      : ((authDatabase as SqliteAuthDatabase)
          .prepare(`SELECT id, image FROM "user" WHERE id IN (${ids.map(() => "?").join(", ")})`)
          .all(...ids));
    const avatars = new Map(authRows.filter((u) => u.image).map((u) => [u.id, u.image!]));
    if (!avatars.size) return rows;
    return rows.map((c) => (c.authorAvatarUrl ? c : { ...c, authorAvatarUrl: avatars.get(c.authUserId) ?? null }));
  } catch (error) {
    if (/no such table|does not exist/i.test(String((error as Error).message))) return rows;
    throw error;
  }
}

function autoApproveHours(): number {
  const n = Number(process.env.COMMENT_AUTO_APPROVE_LINK_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/**
 * Decide a new/edited comment's status from its text. Severity-ordered:
 *  - hard profanity/slur -> pending, NEVER auto-approve (moderator must act).
 *  - review term OR external link -> pending, auto-approve after
 *    COMMENT_AUTO_APPROVE_LINK_HOURS if no moderator acts (softer tier: a human
 *    should glance, but it isn't held indefinitely like hard profanity).
 *  - otherwise -> visible immediately.
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
  if (a.hasReviewTerms || a.hasExternalLinks) {
    return {
      status: "pending",
      flagReason: {
        ...(a.hasReviewTerms ? { reviewTerms: a.reviewTerms } : {}),
        ...(a.hasExternalLinks ? { links: a.externalLinks } : {}),
      },
      autoApproveAt: Math.floor(Date.now() / 1000) + Math.round(autoApproveHours() * 3600),
    };
  }
  return { status: "visible", flagReason: null, autoApproveAt: null };
}

// Throttle the lazy auto-approval sweep on the public read path to at most once
// per minute per server instance. The admin path calls autoApproveDue directly
// via autoApproveDueCommentsForModeration() and is unaffected.
let lastReadSweepAt = 0;

// --- public target-page view -------------------------------------------------

export type PublicComment = {
  id: number;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  // Non-moderators only ever see visible / pending (own) / deleted; the
  // moderator inline view also surfaces hidden + rejected.
  status: "visible" | "pending" | "hidden" | "rejected" | "deleted";
  createdAt: string;
  editedAt: string | null;
  likeCount: number;
  viewerLiked: boolean;
  isOwn: boolean;
  isDeleted: boolean;
  /** Open user reports on this comment. Only populated in the moderator view. */
  reportCount: number;
  replies: PublicComment[];
};

function placeholder(c: CommentRecord): PublicComment {
  return {
    id: Number(c.id),
    authorName: "",
    authorAvatarUrl: null,
    body: "",
    status: "deleted",
    createdAt: c.createdAt,
    editedAt: null,
    likeCount: 0,
    viewerLiked: false,
    isOwn: false,
    isDeleted: true,
    reportCount: 0,
    replies: [],
  };
}

function toPublic(
  c: CommentRecord,
  viewer: string | null,
  counts: Record<number, number>,
  viewerLikes: Set<number>,
  reportCounts: Record<number, number>,
): PublicComment {
  const isDeleted = c.status === "deleted";
  return {
    id: Number(c.id),
    authorName: isDeleted ? "" : c.authorName,
    authorAvatarUrl: isDeleted ? null : c.authorAvatarUrl,
    body: isDeleted ? "" : c.body,
    status: c.status as PublicComment["status"],
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    likeCount: counts[Number(c.id)] ?? 0,
    viewerLiked: viewerLikes.has(Number(c.id)),
    isOwn: Boolean(viewer) && c.discordUserId === viewer,
    isDeleted,
    reportCount: reportCounts[Number(c.id)] ?? 0,
    replies: [],
  };
}

// A reply renders if visible, or pending and owned by the viewer. Moderators
// additionally see every non-deleted reply (pending/hidden/rejected) so they can
// act on it inline.
function replyRenders(c: CommentRecord, viewer: string | null, moderator: boolean): boolean {
  if (c.status === "visible") return true;
  if (moderator) return c.status !== "deleted";
  if (c.status === "pending") return Boolean(viewer) && c.discordUserId === viewer;
  return false;
}

/**
 * Build the threaded comment tree for a target as seen by `viewer`. Runs the lazy
 * auto-approval sweep first (no cron needed). Visibility:
 *  - visible -> shown to all
 *  - pending -> shown only to its author (with a pending badge client-side)
 *  - deleted / pending-not-yours root WITH replies -> placeholder so the thread holds
 */
export async function getTargetCommentsView(
  targetType: "news" | "match",
  targetId: number,
  viewer: string | null,
  { moderator = false }: { moderator?: boolean } = {},
): Promise<PublicComment[]> {
  if (Date.now() - lastReadSweepAt > 60_000) {
    lastReadSweepAt = Date.now();
    await autoApproveDue().catch(() => {});
  }
  const rows = await fillMissingAuthorAvatars(
    await listForTarget(targetType, targetId, 100, { includeAllStatuses: moderator }),
  );
  const ids = rows.map((c) => Number(c.id));
  const [counts, viewerLikes, reportCounts] = await Promise.all([
    (_commentLikeCounts as (ids: number[]) => Promise<Record<number, number>>)(ids),
    viewer
      ? (_viewerCommentLikes as (ids: number[], d: string) => Promise<Set<number>>)(ids, viewer)
      : Promise.resolve(new Set<number>()),
    moderator ? openReportCounts(ids) : Promise.resolve({} as Record<number, number>),
  ]);

  const repliesByRoot = new Map<number, CommentRecord[]>();
  for (const c of rows) {
    if (c.rootCommentId != null) {
      const key = Number(c.rootCommentId);
      if (!repliesByRoot.has(key)) repliesByRoot.set(key, []);
      repliesByRoot.get(key)!.push(c);
    }
  }

  // Moderators see every non-deleted comment; everyone else sees visible + own
  // pending (deleted roots with live replies become a placeholder either way).
  const selfShows = (c: CommentRecord): boolean => {
    if (c.status === "visible") return true;
    if (moderator) return c.status !== "deleted";
    return c.status === "pending" && Boolean(viewer) && c.discordUserId === viewer;
  };

  const out: PublicComment[] = [];
  for (const root of rows.filter((c) => c.rootCommentId == null)) {
    const childPublic = (repliesByRoot.get(Number(root.id)) || [])
      .filter((r) => replyRenders(r, viewer, moderator))
      .map((r) => toPublic(r, viewer, counts, viewerLikes, reportCounts));
    const selfVisible = selfShows(root);

    if (!selfVisible && childPublic.length === 0) continue; // nothing to show
    const node = selfVisible
      ? toPublic(root, viewer, counts, viewerLikes, reportCounts)
      : placeholder(root);
    node.replies = childPublic;
    out.push(node);
  }
  return out;
}

// Compatibility entry point for existing news routes.
export function getPostCommentsView(
  postId: number,
  viewer: string | null,
  options: { moderator?: boolean } = {},
): Promise<PublicComment[]> {
  return getTargetCommentsView("news", postId, viewer, options);
}

// --- mutations + moderation -------------------------------------------------

export type CreateResult = { comment: CommentRecord } | { error: string };

type UserCreateInput = Omit<CreateInput, "status" | "flagReason" | "autoApproveAt">;

export async function createTargetComment(input: UserCreateInput): Promise<CreateResult> {
  const mod = moderationFor(input.body);
  return createComment({ ...input, status: mod.status, flagReason: mod.flagReason, autoApproveAt: mod.autoApproveAt });
}

export function createPostComment(input: Omit<UserCreateInput, "targetType" | "targetId"> & { postId: number }): Promise<CreateResult> {
  return createTargetComment({ ...input, targetType: "news", targetId: input.postId });
}

export function createMatchComment(
  input: Omit<UserCreateInput, "postId" | "targetType" | "targetId"> & { matchId: number },
): Promise<CreateResult> {
  return createTargetComment({ ...input, targetType: "match", targetId: input.matchId });
}

export async function editOwnComment(id: number, body: string): Promise<CommentRecord | null> {
  const mod = moderationFor(body);
  return editComment(id, { body, status: mod.status, flagReason: mod.flagReason, autoApproveAt: mod.autoApproveAt });
}

export function getCommentById(id: number): Promise<CommentRecord | null> {
  return getComment(id);
}

export async function softDeleteComment(
  id: number,
  deletedByDiscordId: string,
): Promise<CommentRecord | null> {
  const updated = await setCommentStatus(id, "deleted", { deletedBy: deletedByDiscordId });
  // The content is gone, so any open reports on it are moot — close them out so
  // they don't linger in the reported queue (an author can delete a comment that
  // was reported below the auto-hide threshold).
  if (updated) await resolveReports(id, "dismissed").catch(() => {});
  return updated;
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
  // A moderator decision closes out the comment's open reports. Restoring a
  // comment dismisses them (the reports were not actionable); every other action
  // resolves them.
  await resolveReports(id, action === "restore" ? "dismissed" : "resolved").catch(() => {});
  return updated;
}

// --- reporting --------------------------------------------------------------

function autoHideThreshold(): number {
  const n = Number(process.env.COMMENT_REPORT_AUTOHIDE_THRESHOLD);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 3;
}

/**
 * Record a user's report of a comment. A repeat report by the same user is a
 * no-op. When a still-visible comment crosses the report threshold it is
 * auto-held (status -> 'pending'): hidden from the public but still visible to
 * its author and to moderators, and fully reversible — a moderator restore
 * brings it back. Returns { held } indicating whether this report triggered the
 * auto-hide.
 */
export async function reportPostComment(
  commentId: number,
  reporter: { discordUserId: string; authUserId: string | null },
  input: { reason: CommentReportReason; detail?: string },
): Promise<{ created: boolean; held: boolean }> {
  const { created, openCount } = await createReport({
    commentId,
    reporterDiscordId: reporter.discordUserId,
    reporterAuthUserId: reporter.authUserId,
    reason: input.reason,
    detail: input.detail ?? "",
  });

  const threshold = autoHideThreshold();
  if (created && threshold > 0 && openCount >= threshold) {
    // Atomic conditional transition: no-op unless the comment is still visible,
    // so a racing moderator/author decision can't be clobbered back to pending.
    const held = await holdVisibleForReports(commentId);
    if (held) {
      await recordModeration({
        commentId,
        moderatorDiscordId: "system",
        moderatorName: "auto-moderation",
        action: "autohide",
        reason: `${openCount} report(s)`,
      });
      return { created, held: true };
    }
  }
  return { created, held: false };
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
  return listMod({ status: filter.status ?? null, flagged: filter.flagged ?? false, limit, offset }).then(fillMissingAuthorAvatars);
}

export function commentStatusCounts(): Promise<Record<string, number>> {
  return countsByStatus();
}

// Reported-comments queue for the admin moderation page: comments with open
// user reports, most-reported first, each carrying its open report count.
export function listReportedModerationComments(
  limit = 100,
  offset = 0,
): Promise<(CommentRecord & { reportOpenCount: number })[]> {
  return listReported({ limit, offset }).then(
    (rows) => fillMissingAuthorAvatars(rows) as Promise<(CommentRecord & { reportOpenCount: number })[]>,
  );
}

// comment_id -> open report count, to annotate an existing moderation list.
export function reportCountsForComments(ids: number[]): Promise<Record<number, number>> {
  return openReportCounts(ids);
}

export function reportedCommentsCount(): Promise<number> {
  return countReported();
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
