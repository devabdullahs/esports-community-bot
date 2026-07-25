import { NextResponse } from "next/server";
import { sameOriginOr403 } from "@/lib/community";
import {
  getViewerDiscordId,
  listPushSubscriptionsForUser,
  revokePushSubscriptionEndpointForUser,
  revokePushSubscriptionForUser,
  upsertPushSubscription,
} from "@/lib/follows";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;
const SUBSCRIPTION_FIELDS = new Set(["endpoint", "expirationTime", "keys"]);
const KEY_FIELDS = new Set(["p256dh", "auth"]);
const DELETE_FIELDS = new Set(["subscriptionId", "endpoint"]);
const BASE64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

function pushConfig() {
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
  return {
    enabled: process.env.WEB_PUSH_ENABLED === "true" && publicKey.length > 0,
    publicKey,
  };
}

function isExactObject(value: unknown, fields: Set<string>): value is Record<string, unknown> {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).every((field) => fields.has(field)),
  );
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_ENDPOINT_LENGTH) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validSubscriptionKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 16
    && value.length <= MAX_KEY_LENGTH
    && BASE64URL_RE.test(value);
}

async function viewerOr401() {
  const discordUserId = await getViewerDiscordId();
  return discordUserId
    ? { discordUserId }
    : { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
}

export async function GET() {
  const viewer = await viewerOr401();
  if ("response" in viewer) return viewer.response;
  const config = pushConfig();
  const subscriptions = await listPushSubscriptionsForUser(viewer.discordUserId);
  return NextResponse.json({
    enabled: config.enabled,
    publicKey: config.enabled ? config.publicKey : null,
    subscriptions,
  });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const viewer = await viewerOr401();
  if ("response" in viewer) return viewer.response;
  const limited = await rateLimitOr429({
    key: `push-subscriptions:create:${viewer.discordUserId}`,
    limit: 10,
    windowSec: 60,
  });
  if (limited) return limited;

  const config = pushConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Browser notifications are unavailable." }, { status: 503 });
  }

  const parsed = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return requestBodyErrorResponse(parsed.reason);
  if (!isExactObject(parsed.value, SUBSCRIPTION_FIELDS)) {
    return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  }
  const body = parsed.value;
  if (!validEndpoint(body.endpoint)
      || (body.expirationTime !== null && body.expirationTime !== undefined
        && (typeof body.expirationTime !== "number" || !Number.isFinite(body.expirationTime)))
      || !isExactObject(body.keys, KEY_FIELDS)
      || !validSubscriptionKey(body.keys.p256dh)
      || !validSubscriptionKey(body.keys.auth)) {
    return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  }

  try {
    const subscription = await upsertPushSubscription({
      discordUserId: viewer.discordUserId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return NextResponse.json({
      subscription: {
        id: subscription.id,
        created_at: subscription.created_at,
        updated_at: subscription.updated_at,
      },
    }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "PUSH_SUBSCRIPTION_OWNER_CONFLICT") {
      return NextResponse.json({ error: "This browser subscription belongs to another account." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const viewer = await viewerOr401();
  if ("response" in viewer) return viewer.response;
  const limited = await rateLimitOr429({
    key: `push-subscriptions:delete:${viewer.discordUserId}`,
    limit: 20,
    windowSec: 60,
  });
  if (limited) return limited;

  const parsed = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return requestBodyErrorResponse(parsed.reason);
  if (!isExactObject(parsed.value, DELETE_FIELDS)) {
    return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  }
  const hasId = Object.hasOwn(parsed.value, "subscriptionId");
  const hasEndpoint = Object.hasOwn(parsed.value, "endpoint");
  if (hasId === hasEndpoint) {
    return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  }
  const changed = hasId
    ? (typeof parsed.value.subscriptionId === "string"
      && parsed.value.subscriptionId.length <= 64
      && /^[0-9a-f-]{36}$/i.test(parsed.value.subscriptionId)
      ? await revokePushSubscriptionForUser({
        discordUserId: viewer.discordUserId,
        subscriptionId: parsed.value.subscriptionId,
      })
      : -1)
    : (validEndpoint(parsed.value.endpoint)
      ? await revokePushSubscriptionEndpointForUser({
        discordUserId: viewer.discordUserId,
        endpoint: parsed.value.endpoint,
      })
      : -1);
  if (changed < 0) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  if (!changed) return NextResponse.json({ error: "Push subscription not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
