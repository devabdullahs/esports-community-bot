import { NextResponse } from "next/server";
import {
  updateCommentKeywordRule as _updateRule,
} from "@bot/db/commentKeywordRules.js";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { parseId, validateCommentKeywordRule } from "@/lib/comment-validation";
import { sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KeywordRule = {
  id: number;
  phrase: string;
  locale: "all" | "en" | "ar";
  scope: "global" | "news" | "match";
  action: "hold" | "flag";
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const updateRule = _updateRule as (id: number, patch: Partial<KeywordRule>) => Promise<KeywordRule | null>;

function duplicateRule(error: unknown) {
  return /unique constraint|duplicate key/i.test(String((error as Error).message));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.isSuper || !access.discordUserId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const limited = await rateLimitOr429({ key: `comment:keyword-rule:${access.discordUserId}`, limit: 30, windowSec: 600 });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const validated = validateCommentKeywordRule(body, { requireAnyField: true });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  try {
    const rule = await updateRule(id, validated.value);
    if (!rule) return NextResponse.json({ error: "Keyword rule not found" }, { status: 404 });
    recordAdminAudit(access, "comment.keyword_rule.update", String(id), {
      locale: rule.locale,
      scope: rule.scope,
      action: rule.action,
      enabled: rule.enabled,
    });
    return NextResponse.json({ rule: {
      id: rule.id,
      phrase: rule.phrase,
      locale: rule.locale,
      scope: rule.scope,
      action: rule.action,
      enabled: rule.enabled,
      createdBy: rule.createdBy,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    } });
  } catch (error) {
    if (duplicateRule(error)) return NextResponse.json({ error: "A matching keyword rule already exists." }, { status: 409 });
    if (error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
