import { NextResponse } from "next/server";
import {
  internalRequestId,
  internalUnauthorizedResponse,
  isInternalRequestAuthorized,
  recordInternalOperation,
} from "@/lib/internal-auth";
import { syncEwcProfileForDiscordUser } from "@/lib/ewc-profile-sync";
import { resolveDefaultGuildId } from "@/lib/guild";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/request-body";
import { isSnowflake, isSeason } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const INTERNAL_PROFILE_SYNC_BODY_MAX_BYTES = 8 * 1024;
const OPERATION = "profile-sync";
const CAPABILITY = "profile-sync";
const BODY_KEYS = new Set(["discordUserId", "guildId", "season"]);

export async function POST(request: Request) {
  const requestId = internalRequestId(request);
  // The caller aborts after a fixed budget; without the duration here a timeout on its side
  // and a success on ours cannot be matched up, which is exactly the state the logs were in.
  const startedAt = Date.now();
  const record = (result: Parameters<typeof recordInternalOperation>[0]["result"]) => {
    recordInternalOperation({
      operation: OPERATION,
      capability: CAPABILITY,
      result,
      requestId,
      durationMs: Date.now() - startedAt,
    });
  };

  if (!isInternalRequestAuthorized(request, CAPABILITY)) {
    record("denied");
    return internalUnauthorizedResponse(CAPABILITY, requestId);
  }
  const parsed = await readBoundedJson<Record<string, unknown>>(
    request,
    INTERNAL_PROFILE_SYNC_BODY_MAX_BYTES,
  );
  if (!parsed.ok) {
    record("rejected");
    return requestBodyErrorResponse(parsed.reason);
  }
  const body = parsed.value;
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.keys(body).some((key) => !BODY_KEYS.has(key))
  ) {
    record("rejected");
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!isSnowflake(body.discordUserId)) {
    record("rejected");
    return NextResponse.json(
      { error: "discordUserId must be a Discord snowflake ID" },
      { status: 400 },
    );
  }
  if (!isSnowflake(body.guildId)) {
    record("rejected");
    return NextResponse.json({ error: "guildId must be a Discord snowflake ID" }, { status: 400 });
  }
  if (!isSeason(body.season)) {
    record("rejected");
    return NextResponse.json({ error: "season must be a 4-digit year" }, { status: 400 });
  }
  // Defense-in-depth backstop in case the internal secret is compromised or a
  // caller loops; keyed per user so the bot's batch sync (distinct users) is unaffected.
  const limited = await rateLimitOr429({ key: `ewc-internal-sync:${body.discordUserId}`, limit: 20, windowSec: 60 });
  if (limited) {
    record("rejected");
    return limited;
  }

  // Linked-role namespaces are server-approved (ECB-SEC-011): the guild is
  // pinned to the configured deployment guild, never a caller-selected
  // format-valid snowflake, so no persistent alternate-namespace link rows
  // or role metadata can be created.
  const configuredGuildId = await resolveDefaultGuildId();
  if (!configuredGuildId) {
    record("failed");
    return NextResponse.json({ error: "EWC guild is not configured." }, { status: 503 });
  }
  if (body.guildId !== configuredGuildId) {
    record("rejected");
    return NextResponse.json({ error: "Guild is not allowed." }, { status: 403 });
  }

  try {
    const result = await syncEwcProfileForDiscordUser({
      discordUserId: body.discordUserId,
      guildId: configuredGuildId,
      season: body.season,
    });
    record("succeeded");
    return NextResponse.json(result);
  } catch {
    record("failed");
    return NextResponse.json({ error: "Profile sync failed." }, { status: 500 });
  }
}
