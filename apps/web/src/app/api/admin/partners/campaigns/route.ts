import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { createPartnerCampaign, getPartner, listPartnerCampaigns } from "@/lib/partners";
import { validatePartnerCampaignInput } from "@/lib/partner-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  return NextResponse.json({ campaigns: await listPartnerCampaigns() });
}
export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const validated = validatePartnerCampaignInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (!(await getPartner(validated.value.partnerId))) {
    return NextResponse.json({ error: "Partner not found." }, { status: 404 });
  }

  const campaign = await createPartnerCampaign(validated.value);
  revalidateTag("cms-partners", "default");
  recordAdminAudit(access, "partner.campaign.create", String(campaign.id), {
    kind: campaign.kind,
    paymentStatus: campaign.paymentStatus,
  });
  return NextResponse.json(campaign);
}
