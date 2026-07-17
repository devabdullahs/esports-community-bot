import { notFound, redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { NewsEditorialCalendar } from "@/components/admin/news-editorial-calendar";
import { canManageGame, canManageMedia, getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listGames } from "@/lib/games";
import { listAdminNewsPosts } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditorialCalendarPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/calendar");
  if (!access.allowed) notFound();

  const [locale, allPosts, games] = await Promise.all([
    getRequestLocale(),
    listAdminNewsPosts({ status: "scheduled" }),
    listGames(),
  ]);
  const t = getAdminCopy(locale);
  const posts = allPosts.filter((post) =>
    post.mediaSlug
      ? canManageMedia(access, post.mediaSlug)
      : post.gameSlug
        ? canManageGame(access, post.gameSlug)
        : false,
  );
  const description =
    locale === "ar"
      ? "\u0631\u0627\u062c\u0639 \u0645\u0646\u0634\u0648\u0631\u0627\u062a\u0643 \u0627\u0644\u0645\u062c\u062f\u0648\u0644\u0629 \u0648\u062d\u062f\u0651\u062b \u0648\u0642\u062a \u0646\u0634\u0631\u0647\u0627."
      : "Review scheduled posts in your scope and adjust their publication time.";

  return (
    <AdminPageShell
      maxWidth="6xl"
      eyebrow={t.common.adminPublishing}
      title={t.dashboard.links.calendarTitle}
      description={description}
      breadcrumbs={[
        { label: t.dashboard.title, href: "/admin" },
        { label: t.dashboard.links.calendarTitle },
      ]}
    >
      <NewsEditorialCalendar posts={posts} games={games} locale={locale} />
    </AdminPageShell>
  );
}
