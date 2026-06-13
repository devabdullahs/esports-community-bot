import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { TeamManager } from "@/components/admin/team-manager";
import { getAdminAccess } from "@/lib/admin";
import { listAdmins } from "@/lib/admins";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { listMediaChannels } from "@/lib/media";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/team");
  if (!access.isSuper) redirect("/admin");

  const admins = await listAdmins();
  const games = (await listGames()).map((g) => ({ slug: g.slug, label: localizeText(g.title, "en") }));
  const media = (await listMediaChannels()).map((c) => ({ slug: c.slug, label: localizeText(c.name, "en") }));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        Back to admin
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">Super admin</p>
        <h1 className="text-3xl font-semibold leading-tight">Admin team</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add admins by Discord ID and assign exactly which games and media channels each one
          can manage. Super admins are configured via the EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS
          environment variable.
        </p>
      </div>
      <TeamManager admins={admins} games={games} media={media} />
    </main>
  );
}
