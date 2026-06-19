import { NextResponse } from "next/server";
import { blockUser as _blockUser, unblockUser } from "@bot/db/communityUserBlocks.js";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { isSnowflake } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The bot DB module is plain JS; its param defaults (= null) make TS infer the
// optional fields as `null | undefined`. Give it an explicit signature so the
// route can pass real string values (mirrors the cast in @/lib/audit).
const blockUser = _blockUser as unknown as (params: {
  discordUserId: string;
  blockedBy: string;
  blockedByName?: string | null;
  reason?: string | null;
}) => Promise<unknown>;

type Ctx = { params: Promise<{ discordId: string }> };

// Shared super-only guard + validation for both handlers. Returns either a
// ready error response, or the validated discordId + access for the handler.
async function guard(request: Request, context: Ctx) {
  const origin = sameOriginOr403(request);
  if (origin) return { error: origin };

  const access = await getAdminAccess();
  if (!access.session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!access.isSuper || !access.discordUserId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const discordId = (await context.params).discordId;
  if (!isSnowflake(discordId)) {
    return { error: NextResponse.json({ error: "Invalid id" }, { status: 400 }) };
  }

  const limited = await rateLimitOr429({ key: `admin:block:${access.discordUserId}`, limit: 30, windowSec: 600 });
  if (limited) return { error: limited };

  // An admin must not lock themselves out of community features.
  if (discordId === access.discordUserId) {
    return { error: NextResponse.json({ error: "You cannot block yourself." }, { status: 400 }) };
  }

  return { access, discordId };
}

export async function POST(request: Request, context: Ctx) {
  const g = await guard(request, context);
  if (g.error) return g.error;
  const { access, discordId } = g;

  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

  await blockUser({
    discordUserId: discordId,
    blockedBy: access.discordUserId!,
    blockedByName: access.displayName,
    reason,
  });
  recordAdminAudit(access, "user.block", discordId, { reason: Boolean(reason) });
  return NextResponse.json({ blocked: true });
}

export async function DELETE(request: Request, context: Ctx) {
  const g = await guard(request, context);
  if (g.error) return g.error;
  const { access, discordId } = g;

  await unblockUser(discordId);
  recordAdminAudit(access, "user.unblock", discordId);
  return NextResponse.json({ blocked: false });
}
