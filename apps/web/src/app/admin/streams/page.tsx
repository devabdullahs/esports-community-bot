import { redirect } from "next/navigation";
import { GAMES as BOT_GAMES } from "@bot/lib/games.js";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { StreamChannelsManager } from "@/components/admin/stream-channels-manager";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";
import { listStreamChannels } from "@/lib/stream-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminStreamsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/streams");
  if (!access.isSuper) redirect("/admin");

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const channels = await listStreamChannels();
  const games = [...new Map(BOT_GAMES.map((game) => [game.slug, game])).values()].map((game) => ({
    slug: game.slug,
    name: game.name,
    tag: game.tag,
  }));

  return (
    <AdminPageShell
      backHref="/admin"
      backLabel={t.common.backToAdmin}
      eyebrow={t.common.adminPublishing}
      title={t.dashboard.links.streamsTitle}
      description={t.dashboard.links.streamsDescription}
    >
      <StreamChannelsManager channels={channels} games={games} />
    </AdminPageShell>
  );
}
