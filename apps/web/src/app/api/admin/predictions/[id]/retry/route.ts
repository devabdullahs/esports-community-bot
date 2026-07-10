import { NextResponse } from "next/server";
import {
  getEwcPredictionOperation,
  retryEwcPredictionOperation,
} from "@bot/db/ewcPredictionOperations.js";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { resolveDefaultGuildId } from "@/lib/guild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  if (!access.discordUserId) return NextResponse.json({ error: "Signed-in admin is missing a Discord ID" }, { status: 400 });
  const limited = await rateLimitOr429({ key: `admin:prediction-operation:retry:${access.discordUserId}`, limit: 10, windowSec: 600 });
  if (limited) return limited;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid operation." }, { status: 400 });
  const operation = await getEwcPredictionOperation(id);
  if (!operation) return NextResponse.json({ error: "Operation not found." }, { status: 404 });
  if (operation.guildId !== await resolveDefaultGuildId()) return NextResponse.json({ error: "Operation not found." }, { status: 404 });
  const retried = await retryEwcPredictionOperation(id);
  if (!retried) return NextResponse.json({ error: "Only failed operations can be retried." }, { status: 409 });
  recordAdminAudit(access, "prediction.operation.retry", id, { operation: operation.operation, season: operation.season });
  return NextResponse.json({ operation: await getEwcPredictionOperation(id) });
}
