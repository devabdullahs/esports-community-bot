import { NextResponse } from "next/server";
import { clientIp, sameOriginOr403 } from "@/lib/community";
import { createPartnerInquiry } from "@/lib/partners";
import { validatePartnerInquiryInput } from "@/lib/partner-validation";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inquiry fields are short free text; 16 KiB comfortably covers the largest
// legitimate submission while bounding anonymous allocation.
const INQUIRY_MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const limited = await rateLimitOr429({
    key: `partner-inquiry:${clientIp(request)}`,
    limit: 3,
    windowSec: 60 * 60,
  });
  if (limited) return limited;

  const body = await readBoundedJson(request, INQUIRY_MAX_BODY_BYTES);
  if (!body.ok) {
    if (body.reason === "too_large") {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const validated = validatePartnerInquiryInput(body.value);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const inquiry = await createPartnerInquiry(validated.value);
  return NextResponse.json({ ok: true, inquiryId: inquiry.id });
}
