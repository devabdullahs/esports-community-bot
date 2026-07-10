import { notFound, redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { GameEditor } from "@/components/admin/game-editor";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { getGame } from "@/lib/games";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditGamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await getAdminAccess();
  if (!access.session) redirect(`/login?callbackURL=/admin/games/${slug}`);
  if (!access.allowed) redirect("/admin");
  if (!canManageGame(access, slug)) redirect("/admin/games");

  const game = await getGame(slug);
  if (!game) notFound();
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.games.title, href: "/admin/games" },
        { label: localizeText(game.title, locale) },
      ]}
      eyebrow={t.common.adminPublishing}
      title={t.games.editTitle}
    >
      <GameEditor mode="edit" game={game} locale={locale} />
    </AdminPageShell>
  );
}
