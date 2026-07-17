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

export const MODERATION_ACTIONS = ["approve", "reject", "hold", "hide", "restore", "delete"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export function parseModerationAction(raw: unknown): ModerationAction | null {
  return (MODERATION_ACTIONS as readonly string[]).includes(raw as string)
    ? (raw as ModerationAction)
    : null;
}

export const BULK_MODERATION_ACTIONS = ["approve", "reject", "hold"] as const;
export type BulkModerationAction = (typeof BULK_MODERATION_ACTIONS)[number];
export const BULK_MODERATION_MAX_IDS = 100;

export function parseBulkModerationAction(raw: unknown): BulkModerationAction | null {
  return (BULK_MODERATION_ACTIONS as readonly string[]).includes(raw as string)
    ? (raw as BulkModerationAction)
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

export const COMMENT_KEYWORD_RULE_MAX_LENGTH = 160;
export const COMMENT_KEYWORD_RULE_LOCALES = ["all", "en", "ar"] as const;
export const COMMENT_KEYWORD_RULE_SCOPES = ["global", "news", "match"] as const;
export const COMMENT_KEYWORD_RULE_ACTIONS = ["hold", "flag"] as const;

export type CommentKeywordRuleLocale = (typeof COMMENT_KEYWORD_RULE_LOCALES)[number];
export type CommentKeywordRuleScope = (typeof COMMENT_KEYWORD_RULE_SCOPES)[number];
export type CommentKeywordRuleAction = (typeof COMMENT_KEYWORD_RULE_ACTIONS)[number];
export type CommentKeywordRulePatch = {
  phrase?: string;
  locale?: CommentKeywordRuleLocale;
  scope?: CommentKeywordRuleScope;
  action?: CommentKeywordRuleAction;
  enabled?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate create or update payloads before they reach the shared DB module. */
export function validateCommentKeywordRule(
  raw: unknown,
  { requirePhrase = false, requireAnyField = false }: { requirePhrase?: boolean; requireAnyField?: boolean } = {},
): { ok: true; value: CommentKeywordRulePatch } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Invalid keyword rule." };
  const value: CommentKeywordRulePatch = {};

  if ("phrase" in raw) {
    if (typeof raw.phrase !== "string") return { ok: false, error: "Keyword phrase is required." };
    const phrase = raw.phrase.trim();
    if (!phrase || phrase.length > COMMENT_KEYWORD_RULE_MAX_LENGTH) {
      return { ok: false, error: `Keyword phrase must be 1-${COMMENT_KEYWORD_RULE_MAX_LENGTH} characters.` };
    }
    value.phrase = phrase;
  } else if (requirePhrase) {
    return { ok: false, error: "Keyword phrase is required." };
  }

  if ("locale" in raw) {
    if (!(COMMENT_KEYWORD_RULE_LOCALES as readonly string[]).includes(raw.locale as string)) {
      return { ok: false, error: "Invalid keyword locale." };
    }
    value.locale = raw.locale as CommentKeywordRuleLocale;
  }
  if ("scope" in raw) {
    if (!(COMMENT_KEYWORD_RULE_SCOPES as readonly string[]).includes(raw.scope as string)) {
      return { ok: false, error: "Invalid keyword scope." };
    }
    value.scope = raw.scope as CommentKeywordRuleScope;
  }
  if ("action" in raw) {
    if (!(COMMENT_KEYWORD_RULE_ACTIONS as readonly string[]).includes(raw.action as string)) {
      return { ok: false, error: "Invalid keyword action." };
    }
    value.action = raw.action as CommentKeywordRuleAction;
  }
  if ("enabled" in raw) {
    if (typeof raw.enabled !== "boolean") return { ok: false, error: "Keyword rule enabled state must be boolean." };
    value.enabled = raw.enabled;
  }
  if (requireAnyField && Object.keys(value).length === 0) {
    return { ok: false, error: "No keyword rule changes supplied." };
  }
  return { ok: true, value };
}
