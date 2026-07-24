import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import {
  internalRequestId,
  internalUnauthorizedResponse,
  isInternalRequestAuthorized,
  recordInternalOperation,
} from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const OPERATION = "news-revalidate";
const CAPABILITY = "news-revalidate";

export async function POST(request: Request) {
  const requestId = internalRequestId(request);
  if (!isInternalRequestAuthorized(request, CAPABILITY)) {
    recordInternalOperation({
      operation: OPERATION,
      capability: CAPABILITY,
      result: "denied",
      requestId,
    });
    return internalUnauthorizedResponse(CAPABILITY, requestId);
  }
  try {
    revalidateTag("cms-news", { expire: 0 });
    recordInternalOperation({
      operation: OPERATION,
      capability: CAPABILITY,
      result: "succeeded",
      requestId,
    });
    return NextResponse.json({ ok: true });
  } catch {
    recordInternalOperation({
      operation: OPERATION,
      capability: CAPABILITY,
      result: "failed",
      requestId,
    });
    return NextResponse.json({ error: "Cache revalidation failed." }, { status: 500 });
  }
}
