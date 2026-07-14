import { NextResponse } from "next/server";
import { sameOriginOr403 } from "@/lib/community";
import {
  deleteFollow,
  getViewerDiscordId,
  isFollowEntityType,
  listFollows,
  updateFollowNotificationOverrides,
  upsertFollow,
} from "@/lib/follows";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

// Follow bodies are a handful of short strings.
const FOLLOW_MAX_BODY_BYTES = 4 * 1024;

async function boundedBody(request: Request) {
  const result = await readBoundedJson(request, FOLLOW_MAX_BODY_BYTES);
  if (!result.ok || !result.value || typeof result.value !== "object" || Array.isArray(result.value)) {
    return null;
  }
  return result.value as Record<string, unknown>;
}

function onlyFields(body: Record<string, unknown>, fields: string[]) {
  return Object.keys(body).every((field) => fields.includes(field));
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_KEY = 120;
const MAX_LABEL = 120;
const MAX_REF = 200;

function cleanText(value: unknown, max: number) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > max) return null;
  return value.trim();
}

async function requireViewer() {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) {
    return { discordUserId: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { discordUserId, error: null };
}

export async function GET() {
  const { discordUserId, error } = await requireViewer();
  if (error) return error;
  const follows = await listFollows(discordUserId!);
  return NextResponse.json({ follows });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const { discordUserId, error } = await requireViewer();
  if (error) return error;
  const limited = await rateLimitOr429({ key: `follows:${discordUserId}`, limit: 30, windowSec: 60 });
  if (limited) return limited;

  const body = await boundedBody(request);
  if (!body || !onlyFields(body, ["entityType", "entityKey", "entityLabel", "entityRef"])) {
    return NextResponse.json({ error: "Invalid follow request." }, { status: 400 });
  }
  const entityType = body.entityType;
  const entityKey = cleanText(body.entityKey, MAX_KEY);
  const entityLabel = cleanText(body.entityLabel, MAX_LABEL);
  const entityRef = cleanText(body.entityRef, MAX_REF);
  if (!isFollowEntityType(entityType) || !entityKey || entityLabel === null || entityRef === null) {
    return NextResponse.json({ error: "Invalid follow target." }, { status: 400 });
  }
  // Player/tournament keys are row ids; a non-numeric key would never match and
  // (worse) poison the Postgres fan-out join. Reject at the boundary.
  if ((entityType === "player" || entityType === "tournament") && !/^\d{1,15}$/.test(entityKey)) {
    return NextResponse.json({ error: "Invalid follow target." }, { status: 400 });
  }
  // Single leading slash only: "//host" is a protocol-relative external URL and
  // must never come back out of the follow list as a link.
  if (entityRef && !/^\/(?!\/)/.test(entityRef)) {
    return NextResponse.json({ error: "Invalid entity ref." }, { status: 400 });
  }

  const follow = await upsertFollow({
    discordUserId: discordUserId!,
    entityType,
    entityKey,
    entityLabel,
    entityRef,
  });
  if (follow && "limited" in follow) {
    return NextResponse.json({ error: "Follow limit reached." }, { status: 409 });
  }
  return NextResponse.json({ follow });
}

export async function DELETE(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const { discordUserId, error } = await requireViewer();
  if (error) return error;
  const limited = await rateLimitOr429({ key: `follows:${discordUserId}`, limit: 30, windowSec: 60 });
  if (limited) return limited;

  const body = await boundedBody(request);
  if (!body || !onlyFields(body, ["entityType", "entityKey"])) {
    return NextResponse.json({ error: "Invalid follow request." }, { status: 400 });
  }
  const entityType = body.entityType;
  const entityKey = cleanText(body.entityKey, MAX_KEY);
  if (!isFollowEntityType(entityType) || !entityKey) {
    return NextResponse.json({ error: "Invalid follow target." }, { status: 400 });
  }

  const removed = await deleteFollow({ discordUserId: discordUserId!, entityType, entityKey });
  return NextResponse.json({ removed });
}

export async function PATCH(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const { discordUserId, error } = await requireViewer();
  if (error) return error;
  const limited = await rateLimitOr429({ key: `follows:${discordUserId}`, limit: 30, windowSec: 60 });
  if (limited) return limited;

  const body = await boundedBody(request);
  if (!body || !onlyFields(body, ["id", "notifyMatchStart", "notifyMatchResult"])) {
    return NextResponse.json({ error: "Invalid follow request." }, { status: 400 });
  }
  const id = body.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid follow id." }, { status: 400 });
  }
  const overrides: { notifyMatchStart?: boolean | null; notifyMatchResult?: boolean | null } = {};
  for (const [field, target] of [
    ["notifyMatchStart", "notifyMatchStart"],
    ["notifyMatchResult", "notifyMatchResult"],
  ] as const) {
    if (body[field] === undefined) continue;
    if (!["inherit", "on", "off"].includes(String(body[field]))) {
      return NextResponse.json({ error: "Invalid follow notification setting." }, { status: 400 });
    }
    overrides[target] = body[field] === "inherit" ? null : body[field] === "on";
  }
  if (!Object.keys(overrides).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const follow = await updateFollowNotificationOverrides({
    discordUserId: discordUserId!,
    followId: id,
    ...overrides,
  });
  if (!follow) return NextResponse.json({ error: "Follow not found." }, { status: 404 });
  return NextResponse.json({ follow });
}
