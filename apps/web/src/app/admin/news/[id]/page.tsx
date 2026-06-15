import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { NewsEditor } from "@/components/admin/news-editor";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { getNewsPost } from "@/lib/news";
import { parsePostId } from "@/lib/news-validation";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

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
  const allGames = await listGames();
  const currentUser = { discordId: access.discordUserId, name: access.displayName };

  // Media post: gate on the owning channel; the related-game picker offers all games.
  if (post.mediaSlug) {
    if (!canManageMedia(access, post.mediaSlug)) redirect("/admin");
    const channel = await getMediaChannel(post.mediaSlug);
    if (!channel) notFound();
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
        <Button
          render={<Link href={`/admin/media/${channel.slug}`} />}
          nativeButton={false}
          variant="ghost"
          className="w-fit"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back to channel
        </Button>
        <div>
          <p className="text-sm text-muted-foreground">Channel publishing</p>
          <h1 className="text-3xl font-semibold leading-tight">Edit post</h1>
        </div>
        <NewsEditor
          mode="edit"
          post={post}
          games={allGames}
          mediaChannel={{ slug: channel.slug, name: localizeText(channel.name, locale) }}
          locale={locale}
          currentUser={currentUser}
        />
      </main>
    );
  }

  // Game post.
  if (!post.gameSlug || !canManageGame(access, post.gameSlug)) redirect("/admin");
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button
        render={<Link href="/admin" />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Back to admin
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">Admin publishing</p>
        <h1 className="text-3xl font-semibold leading-tight">Edit post</h1>
      </div>
      <NewsEditor
        mode="edit"
        post={post}
        games={games}
        locale={locale}
        currentUser={currentUser}
      />
    </main>
  );
}
