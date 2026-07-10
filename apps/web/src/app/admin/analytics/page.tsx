import { redirect } from "next/navigation";
import {
  BarChart3Icon,
  Clock3Icon,
  EyeIcon,
  type LucideIcon,
  MousePointerClickIcon,
  Repeat2Icon,
  TimerIcon,
  UsersIcon,
} from "lucide-react";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { AnalyticsTrendChart } from "@/components/admin/analytics-trend-chart";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { flagEmoji } from "@/lib/country";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { getAnalyticsDashboard, type AnalyticsDay, type AnalyticsMetric } from "@/lib/web-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    title: "Website analytics",
    description: "First-party traffic, audience, and engagement stats from public website visits.",
    eyebrow: "Private analytics",
    overview: "Overview",
    today: "Today",
    week: "7 days",
    month: "30 days",
    visitors: "Visitors",
    returning: "Returning",
    sessions: "Sessions",
    pageviews: "Pageviews",
    avgSession: "Avg. engaged time",
    totalKnown: "Known visitors",
    trendTitle: "Daily active visitors",
    trendDescription: "Visitors, sessions, and pageviews by Riyadh day.",
    countriesTitle: "Countries",
    countriesDescription: "Unique visitors by country.",
    pagesTitle: "Top pages",
    pagesDescription: "Public paths with the most pageviews.",
    country: "Country",
    path: "Path",
    unknownCountry: "Unknown",
    dataNoteTitle: "Data quality",
    dataNote:
      "The tracker ignores admin/API/static pages, common bots, and browsers with DNT or Global Privacy Control enabled. Countries come from Cloudflare headers; raw IP addresses are not stored in analytics events.",
    empty: "No analytics events yet.",
    updated: "Updated",
  },
  ar: {
    title: "إحصائيات الموقع",
    description: "إحصائيات الزيارات والتفاعل من تتبع داخلي للصفحات العامة في الموقع.",
    eyebrow: "إحصائيات خاصة",
    overview: "نظرة عامة",
    today: "اليوم",
    week: "٧ أيام",
    month: "٣٠ يومًا",
    visitors: "الزوار",
    returning: "العائدون",
    sessions: "الجلسات",
    pageviews: "مشاهدات الصفحات",
    avgSession: "متوسط وقت التفاعل",
    totalKnown: "إجمالي الزوار المعروفين",
    trendTitle: "الزوار النشطون يوميًا",
    trendDescription: "الزوار والجلسات والمشاهدات حسب يوم الرياض.",
    countriesTitle: "الدول",
    countriesDescription: "الزوار الفريدون حسب الدولة.",
    pagesTitle: "أعلى الصفحات",
    pagesDescription: "المسارات العامة الأعلى في مشاهدات الصفحات.",
    country: "الدولة",
    path: "المسار",
    unknownCountry: "غير معروف",
    dataNoteTitle: "جودة البيانات",
    dataNote:
      "يتجاهل التتبع صفحات الإدارة وواجهات API والملفات الثابتة والبوتات الشائعة والمتصفحات التي فعّلت DNT أو Global Privacy Control. الدول تأتي من ترويسات Cloudflare ولا يتم تخزين عناوين IP في أحداث الإحصائيات.",
    empty: "لا توجد أحداث إحصائيات بعد.",
    updated: "آخر تحديث",
  },
} satisfies Record<Locale, Record<string, string>>;

function numberFormat(locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US");
}

function dateTimeFormat(locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  });
}

function regionNames(locale: Locale) {
  return new Intl.DisplayNames([locale === "ar" ? "ar" : "en"], { type: "region" });
}

function formatDuration(seconds: number, locale: Locale) {
  const n = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(n / 60);
  const hours = Math.floor(minutes / 60);
  const nf = numberFormat(locale);
  if (hours > 0) {
    const remaining = minutes % 60;
    return locale === "ar"
      ? `${nf.format(hours)} س ${nf.format(remaining)} د`
      : `${nf.format(hours)}h ${nf.format(remaining)}m`;
  }
  if (minutes > 0) {
    const remaining = n % 60;
    return locale === "ar"
      ? `${nf.format(minutes)} د ${nf.format(remaining)} ث`
      : `${nf.format(minutes)}m ${nf.format(remaining)}s`;
  }
  return locale === "ar" ? `${nf.format(n)} ث` : `${nf.format(n)}s`;
}

function countryName(code: string, locale: Locale, unknown: string) {
  if (code === "XX") return unknown;
  if (!/^[A-Z]{2}$/.test(code)) return unknown;
  return regionNames(locale).of(code) || code;
}

export default async function AdminAnalyticsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/analytics");
  if (!access.isSuper) redirect("/admin");

  const locale = await getRequestLocale();
  const adminCopy = getAdminCopy(locale);
  const t = COPY[locale];
  const data = await getAnalyticsDashboard({ days: 30 });
  const nf = numberFormat(locale);
  const updatedAt = dateTimeFormat(locale).format(new Date(data.generatedAt * 1000));

  return (
    <AdminPageShell
      maxWidth="6xl"
      breadcrumbs={[
        { label: adminCopy.dashboard.title, href: "/admin" },
        { label: t.title },
      ]}
      eyebrow={t.eyebrow}
      title={t.title}
      description={t.description}
      badge={data.timezone}
    >
      <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={UsersIcon}
          label={t.today}
          value={nf.format(data.periods.today.visitors)}
          description={`${t.visitors} · ${nf.format(data.periods.today.pageviews)} ${t.pageviews}`}
        />
        <MetricCard
          icon={Repeat2Icon}
          label={t.week}
          value={nf.format(data.periods.sevenDays.returningVisitors)}
          description={`${t.returning} · ${nf.format(data.periods.sevenDays.visitors)} ${t.visitors}`}
        />
        <MetricCard
          icon={MousePointerClickIcon}
          label={t.month}
          value={nf.format(data.periods.thirtyDays.pageviews)}
          description={`${t.pageviews} · ${nf.format(data.periods.thirtyDays.sessions)} ${t.sessions}`}
        />
        <MetricCard
          icon={Clock3Icon}
          label={t.avgSession}
          value={formatDuration(data.periods.thirtyDays.avgSecondsPerSession, locale)}
          description={`${t.totalKnown}: ${nf.format(data.totalKnownVisitors)}`}
        />
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <TrendCard days={data.daily} metric={data.periods.thirtyDays} locale={locale} />
        <Card>
          <CardHeader>
            <CardTitle>{t.overview}</CardTitle>
            <CardDescription>{t.updated}: {updatedAt}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <OverviewRow label={t.visitors} value={nf.format(data.periods.thirtyDays.visitors)} />
            <OverviewRow label={t.returning} value={nf.format(data.periods.thirtyDays.returningVisitors)} />
            <OverviewRow label={t.sessions} value={nf.format(data.periods.thirtyDays.sessions)} />
            <OverviewRow label={t.avgSession} value={formatDuration(data.periods.thirtyDays.avgSecondsPerSession, locale)} />
          </CardContent>
        </Card>
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.countriesTitle}</CardTitle>
            <CardDescription>{t.countriesDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.countries.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.country}</TableHead>
                    <TableHead className="text-end">{t.visitors}</TableHead>
                    <TableHead className="text-end">{t.sessions}</TableHead>
                    <TableHead className="text-end">{t.pageviews}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.countries.map((country) => (
                    <TableRow key={country.country}>
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2">
                          <span>{flagEmoji(country.country) ?? "·"}</span>
                          <span className="truncate">
                            {countryName(country.country, locale, t.unknownCountry)}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{nf.format(country.visitors)}</TableCell>
                      <TableCell className="text-end tabular-nums">{nf.format(country.sessions)}</TableCell>
                      <TableCell className="text-end tabular-nums">{nf.format(country.pageviews)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">{t.empty}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.pagesTitle}</CardTitle>
            <CardDescription>{t.pagesDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.pages.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.path}</TableHead>
                    <TableHead className="text-end">{t.visitors}</TableHead>
                    <TableHead className="text-end">{t.pageviews}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pages.map((page) => (
                    <TableRow key={page.path}>
                      <TableCell className="max-w-[20rem] truncate font-mono text-xs">{page.path}</TableCell>
                      <TableCell className="text-end tabular-nums">{nf.format(page.visitors)}</TableCell>
                      <TableCell className="text-end tabular-nums">{nf.format(page.pageviews)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">{t.empty}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t.dataNoteTitle}</CardTitle>
          <CardDescription>{t.dataNote}</CardDescription>
        </CardHeader>
      </Card>
    </AdminPageShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon data-icon="inline-start" />
          {label}
        </CardDescription>
        <CardTitle className="truncate text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function TrendCard({ days, metric, locale }: { days: AnalyticsDay[]; metric: AnalyticsMetric; locale: Locale }) {
  const t = COPY[locale];
  const nf = numberFormat(locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.trendTitle}</CardTitle>
        <CardDescription>{t.trendDescription}</CardDescription>
        <CardAction>
          <Badge variant="secondary">
            <BarChart3Icon data-icon="inline-start" />
            {nf.format(metric.visitors)} {t.visitors}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AnalyticsTrendChart
          days={days}
          labels={{
            visitors: t.visitors,
            sessions: t.sessions,
            pageviews: t.pageviews,
          }}
        />
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">
            <UsersIcon data-icon="inline-start" />
            {t.visitors}
          </Badge>
          <Badge variant="secondary">
            <EyeIcon data-icon="inline-start" />
            {t.pageviews}
          </Badge>
          <Badge variant="outline">
            <TimerIcon data-icon="inline-start" />
            {formatDuration(metric.engagementSeconds, locale)}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
