import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { deletePartnerCampaign, getPartner, getPartnerCampaign, updatePartnerCampaign } from "@/lib/partners";
import { validatePartnerCampaignInput } from "@/lib/partner-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!(await getPartnerCampaign(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const validated = validatePartnerCampaignInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (!(await getPartner(validated.value.partnerId))) {
    return NextResponse.json({ error: "Partner not found." }, { status: 404 });
  }

  const campaign = await updatePartnerCampaign(id, validated.value);
  revalidateTag("cms-partners", "default");
  recordAdminAudit(access, "partner.campaign.update", String(id), {
    kind: campaign?.kind,
    status: campaign?.status,
    paymentStatus: campaign?.paymentStatus,
  });
  return NextResponse.json(campaign);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const result = await deletePartnerCampaign(id);
  if (!result.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  revalidateTag("cms-partners", "default");
  recordAdminAudit(access, "partner.campaign.delete", String(id));
  return NextResponse.json({ ok: true });
}
