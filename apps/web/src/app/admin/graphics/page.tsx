import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { GraphicsGenerator } from "@/components/admin/graphics-generator";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listGraphicsGeneratorData } from "@/lib/graphics-generator";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminGraphicsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/graphics");
  if (!access.allowed) redirect("/admin");

  const [locale, data] = await Promise.all([
    getRequestLocale(),
    listGraphicsGeneratorData(access),
  ]);
  const t = getAdminCopy(locale);

  return (
    <AdminPageShell
      maxWidth="6xl"
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: locale === "ar" ? "\u0645\u0648\u0644\u062f \u0627\u0644\u0631\u0633\u0648\u0645" : "Graphics generator" },
      ]}
      eyebrow={locale === "ar" ? "\u0627\u0644\u062a\u062d\u0631\u064a\u0631" : "Publishing"}
      title={locale === "ar" ? "\u0645\u0648\u0644\u062f \u0627\u0644\u0631\u0633\u0648\u0645" : "Graphics generator"}
    >
      <GraphicsGenerator data={data} />
    </AdminPageShell>
  );
}
