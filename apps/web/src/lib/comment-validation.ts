export const COMMENT_MAX_LENGTH = 1000;

export function validateCommentBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Comment is required." };
  const body = raw.trim();
  if (!body) return { ok: false, error: "Comment cannot be empty." };
  if (body.length > COMMENT_MAX_LENGTH) {
    return { ok: false, error: `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, body };
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const MODERATION_ACTIONS = ["approve", "reject", "hide", "restore", "delete"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export function parseModerationAction(raw: unknown): ModerationAction | null {
  return (MODERATION_ACTIONS as readonly string[]).includes(raw as string)
    ? (raw as ModerationAction)
    : null;
}

export const COMMENT_STATUSES = ["visible", "pending", "hidden", "rejected", "deleted"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export function parseStatusFilter(raw: string | null): CommentStatus | null {
  return raw && (COMMENT_STATUSES as readonly string[]).includes(raw) ? (raw as CommentStatus) : null;
}

export const COMMENT_REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "other"] as const;
export type CommentReportReason = (typeof COMMENT_REPORT_REASONS)[number];

export const COMMENT_REPORT_DETAIL_MAX = 500;

export function parseReportReason(raw: unknown): CommentReportReason | null {
  return (COMMENT_REPORT_REASONS as readonly string[]).includes(raw as string)
    ? (raw as CommentReportReason)
    : null;
}
