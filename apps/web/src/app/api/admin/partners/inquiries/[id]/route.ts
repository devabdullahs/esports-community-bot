import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { getPartnerInquiry, updatePartnerInquiryStatus } from "@/lib/partners";
import { PARTNER_INQUIRY_STATUSES, type PartnerInquiryStatus } from "@/lib/partner-validation";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PARTNER_INQUIRY_STATUS_BODY_MAX_BYTES = 8 * 1024;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!(await getPartnerInquiry(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await readBoundedJson<Record<string, unknown>>(
    request,
    PARTNER_INQUIRY_STATUS_BODY_MAX_BYTES,
  );
  if (!parsed.ok) return requestBodyErrorResponse(parsed.reason);
  const body = parsed.value;
  const status = typeof body.status === "string" ? body.status : "";
  if (!(PARTNER_INQUIRY_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const inquiry = await updatePartnerInquiryStatus(id, status as PartnerInquiryStatus);
  recordAdminAudit(access, "partner.inquiry.status", String(id), { status });
  return NextResponse.json(inquiry);
}
