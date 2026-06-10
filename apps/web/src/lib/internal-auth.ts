import "server-only";
import { timingSafeEqual } from "node:crypto";
import { internalSecret } from "@/lib/env";

export function isInternalRequestAuthorized(request: Request) {
  const expected = internalSecret();
  if (!expected) return false; // fail closed when unset
  const given = request.headers.get("x-ewc-internal-secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
