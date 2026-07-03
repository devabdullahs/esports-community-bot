import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getAdminAccess, isSuper } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { createPartner, getPartner, listPartnerCampaigns, listPartnerInquiries, listPartners } from "@/lib/partners";
import { validatePartnerInput } from "@/lib/partner-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const [partners, campaigns, inquiries] = await Promise.all([
    listPartners(),
    listPartnerCampaigns(),
    listPartnerInquiries({ limit: 100 }),
  ]);
  return NextResponse.json({ partners, campaigns, inquiries });
}
export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuper(access)) return NextResponse.json({ error: "Super admin only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const validated = validatePartnerInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (await getPartner(validated.value.slug)) {
    return NextResponse.json({ error: `A partner with the slug "${validated.value.slug}" already exists.` }, { status: 409 });
  }

  const partner = await createPartner(validated.value);
  revalidateTag("cms-partners", "default");
  recordAdminAudit(access, "partner.create", partner.slug);
  return NextResponse.json(partner);
}
