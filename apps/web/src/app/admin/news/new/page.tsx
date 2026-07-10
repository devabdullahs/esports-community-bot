import { notFound, redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { NewsEditor } from "@/components/admin/news-editor";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewNewsPostPage({
  searchParams,
}: {
  searchParams: Promise<{ media?: string }>;
}) {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/news/new");
  if (!access.allowed) redirect("/admin");

  const { media: mediaParam } = await searchParams;
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const allGames = await listGames();
  const currentUser = { discordId: access.discordUserId, name: access.displayName };

  // Media post: requires managing the channel; the related-game picker offers all games.
  if (mediaParam) {
    if (!canManageMedia(access, mediaParam)) redirect("/admin");
    const channel = await getMediaChannel(mediaParam);
    if (!channel) notFound();
    const channelName = localizeText(channel.name, locale);
    return (
      <AdminPageShell
        breadcrumbs={[
          { label: t.dashboard.title, href: "/admin" },
          { label: t.dashboard.links.mediaTitle, href: "/admin/media" },
          { label: channelName, href: `/admin/media/${channel.slug}` },
          { label: t.newsList.newPost },
        ]}
        eyebrow={t.common.channelPublishing}
        title={t.newsList.newPost}
        maxWidth="6xl"
      >
        <NewsEditor
          mode="create"
          games={allGames}
          mediaChannel={{ slug: channel.slug, name: channelName }}
          locale={locale}
          currentUser={currentUser}
        />
      </AdminPageShell>
    );
  }

  // Game post: scoped to the admin's games.
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));
  const canManageMediaPosts =
    access.media === "ALL" || (Array.isArray(access.media) && access.media.length > 0);
  if (games.length === 0) {
    if (canManageMediaPosts) redirect("/admin/news/new/media");
    redirect("/admin");
  }

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.games.title, href: "/admin/games" },
        { label: t.newsList.newPost },
      ]}
      eyebrow={t.common.adminPublishing}
      title={t.newsList.newPost}
      maxWidth="6xl"
    >
      <NewsEditor mode="create" games={games} locale={locale} currentUser={currentUser} />
    </AdminPageShell>
  );
}
