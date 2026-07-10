import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { MediaEditor } from "@/components/admin/media-editor";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewMediaChannelPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/media/new");
  if (!access.isSuper) redirect("/admin/media");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.media.title, href: "/admin/media" },
        { label: t.media.newTitle },
      ]}
      eyebrow={t.common.channelPublishing}
      title={t.media.newTitle}
    >
      <MediaEditor mode="create" locale={locale} />
    </AdminPageShell>
  );
}
