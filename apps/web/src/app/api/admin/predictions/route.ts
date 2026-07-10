import { NextResponse } from "next/server";
import { enqueueEwcPredictionOperation } from "@bot/db/ewcPredictionOperations.js";
import { validateEwcPredictionAdminOperation } from "@bot/lib/ewcPredictionOperationValidation.js";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { getAdminPredictionOperationsModel } from "@/lib/admin-predictions";
import { DEFAULT_SEASON } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { isSeason } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDEMPOTENCY_KEY = /^[a-zA-Z0-9_-]{16,120}$/;

function exactOperationBody(value: unknown): value is {
  operation: string;
  args: unknown;
  idempotencyKey: string;
  season?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every((key) => ["operation", "args", "idempotencyKey", "season"].includes(key))
    && typeof body.operation === "string"
    && typeof body.idempotencyKey === "string";
}

async function superAccess() {
  const access = await getAdminAccess();
  if (!access.session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isSuper(access)) return { response: NextResponse.json({ error: "Super admin only" }, { status: 403 }) };
  if (!access.discordUserId) return { response: NextResponse.json({ error: "Signed-in admin is missing a Discord ID" }, { status: 400 }) };
  return { access };
}

export async function GET(request: Request) {
  const gate = await superAccess();
  if ("response" in gate) return gate.response;
  const season = new URL(request.url).searchParams.get("season") || DEFAULT_SEASON;
  if (!isSeason(season)) return NextResponse.json({ error: "Invalid season." }, { status: 400 });
  return NextResponse.json(await getAdminPredictionOperationsModel({ season }));
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const gate = await superAccess();
  if ("response" in gate) return gate.response;

  const limited = await rateLimitOr429({
    key: `admin:prediction-operation:${gate.access.discordUserId}`,
    limit: 20,
    windowSec: 600,
  });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!exactOperationBody(body) || !IDEMPOTENCY_KEY.test(body.idempotencyKey)) {
    return NextResponse.json({ error: "Invalid operation request." }, { status: 400 });
  }
  const season = body.season || DEFAULT_SEASON;
  if (!isSeason(season)) return NextResponse.json({ error: "Invalid season." }, { status: 400 });
  const validated = validateEwcPredictionAdminOperation(body.operation, body.args);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return NextResponse.json({ error: "No configured Discord guild." }, { status: 409 });

  const enqueued = await enqueueEwcPredictionOperation({
    guildId,
    season,
    operation: body.operation,
    args: validated.value,
    idempotencyKey: body.idempotencyKey,
    requestedActorId: gate.access.discordUserId,
    requestedActorType: "web-super-admin",
  });
  if (enqueued.created) {
    recordAdminAudit(gate.access, "prediction.operation.enqueue", enqueued.operation.id, {
      operation: enqueued.operation.operation,
      season,
      status: enqueued.operation.status,
    });
  }
  return NextResponse.json({ operation: enqueued.operation, created: enqueued.created }, { status: enqueued.created ? 202 : 200 });
}
