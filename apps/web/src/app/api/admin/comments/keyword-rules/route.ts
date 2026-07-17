import { NextResponse } from "next/server";
import {
  createCommentKeywordRule as _createRule,
  listCommentKeywordRules as _listRules,
} from "@bot/db/commentKeywordRules.js";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { validateCommentKeywordRule } from "@/lib/comment-validation";
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

const listRules = _listRules as () => Promise<KeywordRule[]>;
const createRule = _createRule as (input: {
  phrase: string;
  locale: KeywordRule["locale"];
  scope: KeywordRule["scope"];
  action: KeywordRule["action"];
  enabled?: boolean;
  createdBy: string;
}) => Promise<KeywordRule>;

function ruleJson(rule: KeywordRule) {
  return {
    id: rule.id,
    phrase: rule.phrase,
    locale: rule.locale,
    scope: rule.scope,
    action: rule.action,
    enabled: rule.enabled,
    createdBy: rule.createdBy,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

async function superAdmin() {
  const access = await getAdminAccess();
  if (!access.session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!access.isSuper || !access.discordUserId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { access };
}

function duplicateRule(error: unknown) {
  return /unique constraint|duplicate key/i.test(String((error as Error).message));
}

export async function GET() {
  const guard = await superAdmin();
  if (guard.error) return guard.error;
  const rules = await listRules();
  return NextResponse.json({ rules: rules.map(ruleJson) });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const guard = await superAdmin();
  if (guard.error) return guard.error;
  const limited = await rateLimitOr429({ key: `comment:keyword-rule:${guard.access.discordUserId}`, limit: 30, windowSec: 600 });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const validated = validateCommentKeywordRule(body, { requirePhrase: true });
  if (!validated.ok || !validated.value.action) {
    return NextResponse.json({ error: validated.ok ? "Keyword action is required." : validated.error }, { status: 400 });
  }

  try {
    const rule = await createRule({
      phrase: validated.value.phrase!,
      locale: validated.value.locale ?? "all",
      scope: validated.value.scope ?? "global",
      action: validated.value.action,
      enabled: validated.value.enabled ?? true,
      createdBy: guard.access.discordUserId!,
    });
    recordAdminAudit(guard.access, "comment.keyword_rule.create", String(rule.id), {
      locale: rule.locale,
      scope: rule.scope,
      action: rule.action,
      enabled: rule.enabled,
    });
    return NextResponse.json({ rule: ruleJson(rule) }, { status: 201 });
  } catch (error) {
    if (duplicateRule(error)) return NextResponse.json({ error: "A matching keyword rule already exists." }, { status: 409 });
    if (error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
