import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { GamesList } from "@/components/admin/games-list";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listGames } from "@/lib/games";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminGamesPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/games");
  if (!access.allowed) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const allGames = await listGames();
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));

  return (
    <AdminPageShell
      backHref="/admin"
      backLabel={t.common.backToAdmin}
      eyebrow={t.common.adminPublishing}
      title={t.games.title}
      description={t.games.description}
    >
      <GamesList games={games} canManageGames={access.isSuper} locale={locale} />
    </AdminPageShell>
  );
}
