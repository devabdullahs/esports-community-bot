import { NextResponse } from "next/server";
import { clientIp, sameOriginOr403 } from "@/lib/community";
import { createPartnerInquiry } from "@/lib/partners";
import { validatePartnerInquiryInput } from "@/lib/partner-validation";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const limited = await rateLimitOr429({
    key: `partner-inquiry:${clientIp(request)}`,
    limit: 3,
    windowSec: 60 * 60,
  });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const validated = validatePartnerInquiryInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const inquiry = await createPartnerInquiry(validated.value);
  return NextResponse.json({ ok: true, inquiryId: inquiry.id });
}
