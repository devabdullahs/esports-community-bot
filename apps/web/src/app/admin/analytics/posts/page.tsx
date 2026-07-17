import { redirect } from "next/navigation";
import { PostAnalyticsDashboard } from "@/components/admin/post-analytics-dashboard";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { listAdminNewsPosts } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";
import { getPostAnalytics } from "@/lib/web-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AllPostAnalyticsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/analytics/posts");
  if (!access.isSuper) redirect("/admin");

  const locale = await getRequestLocale();
  const [analytics, posts] = await Promise.all([getPostAnalytics(), listAdminNewsPosts({ status: "published" })]);
  const t = getAdminCopy(locale);
  const title = locale === "ar" ? "تحليلات جميع المنشورات" : "All post analytics";

  return (
    <AdminPageShell
      maxWidth="6xl"
      breadcrumbs={[{ label: t.dashboard.title, href: "/admin" }, { label: "Website analytics", href: "/admin/analytics" }, { label: title }]}
      eyebrow={locale === "ar" ? "تحليلات خاصة" : "Private analytics"}
      title={title}
      description={locale === "ar" ? "مقارنة أداء كل المنشورات المنشورة خلال آخر 30 يوماً." : "Compare every published post for the last 30 days."}
      badge={analytics.timezone}
    >
      <PostAnalyticsDashboard
        analytics={analytics}
        postTitles={new Map(posts.map((post) => [post.id, post.title]))}
        locale={locale}
      />
    </AdminPageShell>
  );
}
