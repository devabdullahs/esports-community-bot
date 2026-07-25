import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  enqueueTournamentOperation,
  getTournamentOperation,
  retryTournamentOperation,
  tournamentOperationIdempotencyKey,
} from "@bot/db/tournamentOperations.js";
import { getTournamentById } from "@bot/db/tournaments.js";
import { parseTournamentInput } from "@bot/lib/parseTournamentInput.js";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY_LIMIT = 16 * 1024;
const TOURNAMENT_INTENTS = new Set([
  "sync_schedule",
  "sync_standings",
  "archive",
  "deactivate",
  "reactivate",
]);
const NONCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$/;
const OPERATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f-]{27,35}$/i;

function configuredGuildId() {
  const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
  return /^\d{1,32}$/.test(guildId) ? guildId : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const guildId = configuredGuildId();
  if (!guildId) {
    return NextResponse.json({ error: "Tournament operations are not configured." }, { status: 503 });
  }

  const parsedBody = await readBoundedJson<Record<string, unknown>>(request, BODY_LIMIT);
  if (!parsedBody.ok) return requestBodyErrorResponse(parsedBody.reason);
  const body = parsedBody.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const intent = typeof body.intent === "string" ? body.intent : "";
  if (intent === "retry_operation") {
    if (!hasOnlyKeys(body, ["intent", "operationId"])) {
      return NextResponse.json({ error: "Unsupported request fields." }, { status: 400 });
    }
    const operationId = typeof body.operationId === "string" ? body.operationId : "";
    if (!OPERATION_ID_RE.test(operationId)) {
      return NextResponse.json({ error: "A valid operation id is required." }, { status: 400 });
    }
    const operation = await getTournamentOperation(operationId);
    if (!operation || operation.guildId !== guildId) {
      return NextResponse.json({ error: "Operation not found." }, { status: 404 });
    }
    if (operation.status !== "failed") {
      return NextResponse.json({ error: "Only failed operations can be retried." }, { status: 409 });
    }
    const retried = await retryTournamentOperation(operationId);
    if (!retried) {
      return NextResponse.json({ error: "This operation can no longer be retried." }, { status: 409 });
    }
    recordAdminAudit(access, "tournament.operation.retry", operationId, {
      tournamentId: operation.tournamentId,
      operation: operation.operation,
    });
    revalidatePath("/admin/tournaments");
    return NextResponse.json({ operationId, status: "queued" });
  }

  if (intent === "validate_and_activate") {
    if (!hasOnlyKeys(body, ["intent", "input", "game", "nonce"])) {
      return NextResponse.json({ error: "Unsupported request fields." }, { status: 400 });
    }
    const input = typeof body.input === "string" ? body.input.trim() : "";
    const game = body.game == null || body.game === "" ? null : String(body.game).trim();
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    const tournament = parseTournamentInput(input);
    if (!tournament || !NONCE_RE.test(nonce)) {
      return NextResponse.json(
        { error: "Provide a supported tournament URL or identifier." },
        { status: 400 },
      );
    }
    const operationRequest = {
      guildId,
      operation: "validate_and_activate",
      source: tournament.source,
      sourceId: tournament.externalId,
      game: game || tournament.game,
      requestedActorId: access.discordUserId,
      requestedActorName: access.displayName,
      requestedActorType: "web_admin",
    };
    try {
      const queued = await enqueueTournamentOperation({
        ...operationRequest,
        idempotencyKey: tournamentOperationIdempotencyKey(operationRequest, nonce),
      });
      recordAdminAudit(access, "tournament.operation.enqueue", queued.operation.id, {
        operation: "validate_and_activate",
        source: tournament.source,
        sourceId: tournament.externalId,
        game: game || tournament.game,
      });
      revalidatePath("/admin/tournaments");
      return NextResponse.json(
        { operation: queued.operation, created: queued.created },
        { status: queued.created ? 202 : 200 },
      );
    } catch {
      return NextResponse.json({ error: "The source or game is not valid." }, { status: 400 });
    }
  }

  if (!TOURNAMENT_INTENTS.has(intent)) {
    return NextResponse.json({ error: "Unsupported tournament operation." }, { status: 400 });
  }
  if (!hasOnlyKeys(body, ["intent", "tournamentId", "nonce"])) {
    return NextResponse.json({ error: "Unsupported request fields." }, { status: 400 });
  }
  const tournamentId = Math.floor(Number(body.tournamentId));
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0 || !NONCE_RE.test(nonce)) {
    return NextResponse.json({ error: "A valid tournament and request id are required." }, { status: 400 });
  }
  const tournament = await getTournamentById(tournamentId);
  if (!tournament || String(tournament.guild_id) !== guildId) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  const operationRequest = {
    guildId,
    tournamentId,
    operation: intent,
    requestedActorId: access.discordUserId,
    requestedActorName: access.displayName,
    requestedActorType: "web_admin",
  };
  const queued = await enqueueTournamentOperation({
    ...operationRequest,
    idempotencyKey: tournamentOperationIdempotencyKey(operationRequest, nonce),
  });
  recordAdminAudit(access, "tournament.operation.enqueue", queued.operation.id, {
    tournamentId,
    operation: intent,
  });
  revalidatePath("/admin/tournaments");
  return NextResponse.json(
    { operation: queued.operation, created: queued.created },
    { status: queued.created ? 202 : 200 },
  );
}
