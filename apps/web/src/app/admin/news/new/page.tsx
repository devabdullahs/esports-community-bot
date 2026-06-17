import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { NewsEditor } from "@/components/admin/news-editor";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

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
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
        <Button
          render={<Link href={`/admin/media/${channel.slug}`} />}
          nativeButton={false}
          variant="ghost"
          className="w-fit"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {t.common.backToChannel}
        </Button>
        <div>
          <p className="text-sm text-muted-foreground">{t.common.channelPublishing}</p>
          <h1 className="text-3xl font-semibold leading-tight">{t.newsList.newPost}</h1>
        </div>
        <NewsEditor
          mode="create"
          games={allGames}
          mediaChannel={{ slug: channel.slug, name: localizeText(channel.name, locale) }}
          locale={locale}
          currentUser={currentUser}
        />
      </main>
    );
  }

  // Game post: scoped to the admin's games.
  const games =
    access.games === "ALL" ? allGames : allGames.filter((g) => access.games.includes(g.slug));
  if (games.length === 0) redirect("/admin");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <Button
        render={<Link href="/admin" />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToAdmin}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.adminPublishing}</p>
        <h1 className="text-3xl font-semibold leading-tight">{t.newsList.newPost}</h1>
      </div>
      <NewsEditor mode="create" games={games} locale={locale} currentUser={currentUser} />
    </main>
  );
}
