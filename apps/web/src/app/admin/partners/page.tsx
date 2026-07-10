import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { PartnersManager } from "@/components/admin/partners-manager";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";
import { githubSponsorsUrl, listPartnerCampaigns, listPartnerInquiries, listPartners } from "@/lib/partners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    eyebrow: "Partner operations",
    title: "Community partners",
    description:
      "Review partner inquiries, track manual payments, and control the small sponsor recognition blocks shown on public pages.",
    back: "Back to admin",
  },
  ar: {
    eyebrow: "عمليات الشركاء",
    title: "شركاء المجتمع",
    description:
      "راجع طلبات الشراكة، وتتبع المدفوعات اليدوية، وتحكم في مساحات الظهور الصغيرة المعروضة في الصفحات العامة.",
    back: "العودة للإدارة",
  },
} as const;

export default async function AdminPartnersPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/partners");
  if (!access.isSuper) redirect("/admin");

  const locale = await getRequestLocale();
  const t = COPY[locale];
  const adminCopy = getAdminCopy(locale);
  const [partners, campaigns, inquiries] = await Promise.all([
    listPartners(),
    listPartnerCampaigns(),
    listPartnerInquiries({ limit: 100 }),
  ]);

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: adminCopy.dashboard.title, href: "/admin" },
        { label: t.title },
      ]}
      eyebrow={t.eyebrow}
      title={t.title}
      description={t.description}
    >
      <PartnersManager
        partners={partners}
        campaigns={campaigns}
        inquiries={inquiries}
        githubSponsorsUrl={githubSponsorsUrl()}
        locale={locale}
      />
    </AdminPageShell>
  );
}
