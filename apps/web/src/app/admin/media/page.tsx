import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { MediaList } from "@/components/admin/media-list";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listMediaChannels } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminMediaPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/media");
  if (!access.allowed) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const channels = await listMediaChannels();
  const editableSlugs =
    access.media === "ALL" ? channels.map((c) => c.slug) : access.media;

  return (
    <AdminPageShell
      backHref="/admin"
      backLabel={t.common.backToAdmin}
      eyebrow={t.common.channelPublishing}
      title={t.media.title}
      description={access.isSuper ? t.media.descriptionSuper : t.media.descriptionScoped}
    >
      <MediaList
        channels={channels}
        isSuper={access.isSuper}
        editableSlugs={editableSlugs}
        locale={locale}
      />
    </AdminPageShell>
  );
}
