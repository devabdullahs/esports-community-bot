import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { TeamManager } from "@/components/admin/team-manager";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listAdmins } from "@/lib/admins";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { listMediaChannels } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/team");
  if (!access.isSuper) redirect("/admin");
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  const admins = await listAdmins();
  const games = (await listGames()).map((g) => ({ slug: g.slug, label: localizeText(g.title, locale) }));
  const media = (await listMediaChannels()).map((c) => ({ slug: c.slug, label: localizeText(c.name, locale) }));

  return (
    <AdminPageShell
      backHref="/admin"
      backLabel={t.common.backToAdmin}
      eyebrow={t.common.superAdmin}
      title={t.team.title}
      description={t.team.description}
    >
      <TeamManager admins={admins} games={games} media={media} locale={locale} />
    </AdminPageShell>
  );
}
