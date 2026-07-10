import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { GameEditor } from "@/components/admin/game-editor";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewGamePage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/games/new");
  if (!access.isSuper) redirect("/admin/games");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.games.title, href: "/admin/games" },
        { label: t.games.newTitle },
      ]}
      eyebrow={t.common.adminPublishing}
      title={t.games.newTitle}
    >
      <GameEditor mode="create" locale={locale} />
    </AdminPageShell>
  );
}
