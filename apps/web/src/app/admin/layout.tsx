import { notFound, redirect } from "next/navigation";
import { AdminDashboardShell } from "@/components/admin/admin-dashboard-shell";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin");
  if (!access.allowed) notFound(); // don't advertise the admin area to non-staff

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const roleLabel = access.isSuper ? t.common.superAdmin : t.dashboard.roleScoped;
  const canManageGamePosts =
    access.games === "ALL" || (Array.isArray(access.games) && access.games.length > 0);
  const canManageMediaPosts =
    access.media === "ALL" || (Array.isArray(access.media) && access.media.length > 0);

  return (
    <AdminDashboardShell
      locale={locale}
      isSuper={access.isSuper}
      canManageGamePosts={canManageGamePosts}
      canManageMediaPosts={canManageMediaPosts}
      displayName={access.displayName}
      roleLabel={roleLabel}
    >
      {children}
    </AdminDashboardShell>
  );
}
