import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { CommentModeration } from "@/components/admin/comment-moderation";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminCommentsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/comments");
  if (!access.allowed) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.comments.title },
      ]}
      eyebrow={t.common.moderation}
      title={t.comments.title}
      description={t.comments.description}
    >
      <CommentModeration locale={locale} canManageGlobalModeration={access.isSuper} />
    </AdminPageShell>
  );
}
