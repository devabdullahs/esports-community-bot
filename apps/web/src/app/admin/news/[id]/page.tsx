import { notFound, redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { NewsEditor } from "@/components/admin/news-editor";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { getNewsPost } from "@/lib/news";
import { parsePostId } from "@/lib/news-validation";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditNewsPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await getAdminAccess();
  if (!access.session) redirect(`/login?callbackURL=/admin/news/${id}`);
  if (!access.allowed) redirect("/admin");

  const postId = parsePostId(id);
  if (postId === null) notFound();
  const post = await getNewsPost(postId);
  if (!post) notFound();

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const allGames = await listGames();
  const currentUser = { discordId: access.discordUserId, name: access.displayName };
  const postTitle = post.title || t.newsList.editPost;

  // Media post: gate on the owning channel; the related-game picker offers all games.
  if (post.mediaSlug) {
    if (!canManageMedia(access, post.mediaSlug)) redirect("/admin");
    const channel = await getMediaChannel(post.mediaSlug);
    if (!channel) notFound();
    const channelName = localizeText(channel.name, locale);
    return (
      <AdminPageShell
        breadcrumbs={[
          { label: t.dashboard.title, href: "/admin" },
          { label: t.media.title, href: "/admin/media" },
          { label: channelName, href: `/admin/media/${channel.slug}` },
          { label: postTitle },
        ]}
        eyebrow={t.common.channelPublishing}
        title={t.newsList.editPost}
        maxWidth="6xl"
      >
        <NewsEditor
          mode="edit"
          post={post}
          games={allGames}
          mediaChannel={{ slug: channel.slug, name: channelName }}
          locale={locale}
          currentUser={currentUser}
        />
      </AdminPageShell>
    );
  }

  // Game post.
  if (!post.gameSlug || !canManageGame(access, post.gameSlug)) redirect("/admin");
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));
  const game = allGames.find((candidate) => candidate.slug === post.gameSlug);
  const gameName = game ? localizeText(game.title, locale) : post.gameSlug;

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.games.title, href: "/admin/games" },
        { label: gameName, href: `/admin/games/${post.gameSlug}` },
        { label: postTitle },
      ]}
      eyebrow={t.common.adminPublishing}
      title={t.newsList.editPost}
      maxWidth="6xl"
    >
      <NewsEditor
        mode="edit"
        post={post}
        games={games}
        locale={locale}
        currentUser={currentUser}
      />
    </AdminPageShell>
  );
}
