import { notFound, redirect } from "next/navigation";
import { AdminDashboardShell } from "@/components/admin/admin-dashboard-shell";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [access, locale] = await Promise.all([getAdminAccess(), getRequestLocale()]);
  if (!access.session) {
    const callbackURL = localizedPath("/admin", locale);
    redirect(localizedPath(`/login?callbackURL=${encodeURIComponent(callbackURL)}`, locale));
  }
  if (!access.allowed) notFound(); // don't advertise the admin area to non-staff

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
