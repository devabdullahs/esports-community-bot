import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  internalCapabilitySecret,
  type InternalCapability,
} from "@/lib/env";

const MIN_SECRET_LENGTH = 32;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

function validSecret(value: string) {
  if (value.length < MIN_SECRET_LENGTH) return false;
  if (value !== value.trim() || /[\x00-\x20\x7f]/.test(value)) return false;
  const normalized = value.trim().toLowerCase();
  return !normalized.includes("generate-")
    && !normalized.includes("change-me")
    && !normalized.includes("placeholder");
}

export function isInternalRequestAuthorized(
  request: Request,
  capability: InternalCapability,
) {
  const expected = internalCapabilitySecret(capability);
  if (!validSecret(expected)) return false;
  const given = request.headers.get("x-ewc-internal-secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function internalRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id") || "";
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function internalUnauthorizedResponse(
  capability: InternalCapability,
  requestId: string,
) {
  return NextResponse.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: {
        "Cache-Control": "private, no-store",
        "X-EC-Internal-Capability": capability,
        "X-Request-Id": requestId,
      },
    },
  );
}

export function recordInternalOperation({
  operation,
  capability,
  result,
  requestId,
}: {
  operation: "profile-sync" | "news-revalidate";
  capability: InternalCapability;
  result: "authorized" | "denied" | "rejected" | "succeeded" | "failed";
  requestId: string;
}) {
  console.info(JSON.stringify({
    event: "internal-operation",
    operation,
    capability,
    result,
    requestId,
  }));
}
