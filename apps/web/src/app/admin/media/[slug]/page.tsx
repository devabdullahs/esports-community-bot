import { notFound, redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { MediaEditor } from "@/components/admin/media-editor";
import { NewsList } from "@/components/admin/news-list";
import { canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { getMediaChannel } from "@/lib/media";
import { listAdminNewsPosts } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";

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
  const channelName = localizeText(channel.name, locale);
  const [posts, games] = await Promise.all([
    listAdminNewsPosts({ mediaSlug: slug }),
    listGames(),
  ]);

  return (
    <AdminPageShell
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.media.title, href: "/admin/media" },
        { label: channelName },
      ]}
      eyebrow={t.common.channelPublishing}
      title={t.media.editTitle}
    >
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
    </AdminPageShell>
  );
}
