import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { PostAnalyticsDashboard } from "@/components/admin/post-analytics-dashboard";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { Button } from "@/components/ui/button";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { getGame } from "@/lib/games";
import { localizedPath } from "@/lib/i18n";
import { listAdminNewsPosts } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";
import { getPostAnalytics } from "@/lib/web-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GamePostAnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await getAdminAccess();
  if (!access.session) redirect(`/login?callbackURL=/admin/games/${slug}/analytics`);
  if (!access.allowed || !canManageGame(access, slug)) redirect("/admin/games");

  const game = await getGame(slug);
  if (!game) notFound();

  const locale = await getRequestLocale();
  const [analytics, posts] = await Promise.all([
    getPostAnalytics({ gameSlug: slug }),
    listAdminNewsPosts({ gameSlug: slug, status: "published" }),
  ]);
  const t = getAdminCopy(locale);
  const gameName = localizeText(game.title, locale);

  return (
    <AdminPageShell
      maxWidth="6xl"
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.games.title, href: "/admin/games" },
        { label: gameName, href: `/admin/games/${slug}` },
        { label: locale === "ar" ? "تحليلات المنشورات" : "Post analytics" },
      ]}
      eyebrow={locale === "ar" ? "تحليلات خاصة باللعبة" : "Game analytics"}
      title={locale === "ar" ? `تحليلات ${gameName}` : `${gameName} analytics`}
      description={locale === "ar" ? "أداء المنشورات المنشورة خلال آخر 30 يوماً." : "Published post performance for the last 30 days."}
      badge={analytics.timezone}
      actions={
        <Button variant="outline" render={<Link href={localizedPath(`/admin/games/${slug}`, locale)} />} nativeButton={false}>
          <PencilIcon data-icon="inline-start" />
          {t.common.edit}
        </Button>
      }
    >
      <PostAnalyticsDashboard
        analytics={analytics}
        postTitles={new Map(posts.map((post) => [post.id, post.title]))}
        locale={locale}
      />
    </AdminPageShell>
  );
}
