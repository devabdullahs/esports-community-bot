import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { MediaEditor } from "@/components/admin/media-editor";
import { NewsList } from "@/components/admin/news-list";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listGames } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { listAdminNewsPosts } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditMediaChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await getAdminAccess();
  if (!access.session) redirect(`/login?callbackURL=/admin/media/${slug}`);
  if (!access.allowed) redirect("/admin");
  if (!canManageMedia(access, slug)) redirect("/admin/media");

  const channel = await getMediaChannel(slug);
  if (!channel) notFound();
  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const [posts, games] = await Promise.all([
    listAdminNewsPosts({ mediaSlug: slug }),
    listGames(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <Button render={<Link href="/admin/media" />} nativeButton={false} variant="ghost" className="w-fit">
        <ArrowLeftIcon data-icon="inline-start" />
        {t.common.backToChannels}
      </Button>
      <div>
        <p className="text-sm text-muted-foreground">{t.common.adminPublishing}</p>
        <h1 className="text-3xl font-semibold leading-tight">{t.media.editTitle}</h1>
      </div>
      <MediaEditor mode="edit" channel={channel} locale={locale} />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t.media.postsTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {t.media.channelPostsDescription}
          </p>
        </div>
        <NewsList posts={posts} games={games} locale={locale} newPostHref={`/admin/news/new?media=${slug}`} />
      </section>
    </main>
  );
}
