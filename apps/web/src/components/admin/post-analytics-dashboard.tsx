import { Clock3Icon, EyeIcon, TimerIcon, type LucideIcon, UsersIcon } from "lucide-react";
import { AnalyticsTrendChart } from "@/components/admin/analytics-trend-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { flagEmoji } from "@/lib/country";
import type { Locale } from "@/lib/i18n";
import type { PostAnalyticsDashboard as PostAnalyticsData } from "@/lib/web-analytics";

const COPY = {
  en: {
    views: "Views",
    visitors: "Unique visitors",
    sessions: "Sessions",
    averageEngagement: "Avg. engaged time",
    dailyTitle: "Daily post traffic",
    dailyDescription: "Views, unique visitors, and sessions by Riyadh day.",
    postsTitle: "Post comparison",
    postsDescription: "Published posts ranked by tracked views in the selected period.",
    post: "Post",
    sourcesTitle: "Traffic sources",
    sourcesDescription: "Privacy-safe source categories for tracked post views.",
    source: "Source",
    countriesTitle: "Countries",
    countriesDescription: "Aggregate audience location where the platform provides a country code.",
    country: "Country",
    empty: "No published posts with analytics yet.",
    dataNote: "Counts reflect only visits collected under the existing consent and privacy controls. Raw visitor and session identifiers are never shown here.",
    direct: "Direct",
    x: "X",
    discord: "Discord",
    google: "Google",
    bing: "Bing",
    otherReferral: "Other referral",
  },
  ar: {
    views: "المشاهدات",
    visitors: "الزوار الفريدون",
    sessions: "الجلسات",
    averageEngagement: "متوسط وقت التفاعل",
    dailyTitle: "زيارات المنشورات اليومية",
    dailyDescription: "المشاهدات والزوار الفريدون والجلسات حسب يوم الرياض.",
    postsTitle: "مقارنة المنشورات",
    postsDescription: "المنشورات المنشورة مرتبة حسب المشاهدات المسجلة في الفترة المحددة.",
    post: "المنشور",
    sourcesTitle: "مصادر الزيارات",
    sourcesDescription: "فئات مصادر تراعي الخصوصية لمشاهدات المنشورات المسجلة.",
    source: "المصدر",
    countriesTitle: "الدول",
    countriesDescription: "موقع الجمهور المجمع عندما توفر المنصة رمز البلد.",
    country: "الدولة",
    empty: "لا توجد منشورات منشورة بها بيانات تحليلات بعد.",
    dataNote: "تعكس الأعداد الزيارات التي تم جمعها فقط ضمن ضوابط الموافقة والخصوصية الحالية. لا يتم عرض أي معرّفات خام للزوار أو الجلسات هنا.",
    direct: "مباشر",
    x: "X",
    discord: "ديسكورد",
    google: "Google",
    bing: "Bing",
    otherReferral: "إحالة أخرى",
  },
} as const;

function numberFormat(locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US");
}

function formatDuration(seconds: number, locale: Locale) {
  const n = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(n / 60);
  const remaining = n % 60;
  const nf = numberFormat(locale);
  if (minutes > 0) return locale === "ar" ? `${nf.format(minutes)} د ${nf.format(remaining)} ث` : `${nf.format(minutes)}m ${nf.format(remaining)}s`;
  return locale === "ar" ? `${nf.format(n)} ث` : `${nf.format(n)}s`;
}

function sourceName(source: string, locale: Locale) {
  const t = COPY[locale];
  const labels: Record<string, string> = {
    direct: t.direct,
    x: t.x,
    discord: t.discord,
    google: t.google,
    bing: t.bing,
    other_referral: t.otherReferral,
  };
  return labels[source] || source;
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
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
    </Card>
  );
}

export function PostAnalyticsDashboard({
  analytics,
  postTitles,
  locale,
}: {
  analytics: PostAnalyticsData;
  postTitles: Map<number, string>;
  locale: Locale;
}) {
  const t = COPY[locale];
  const nf = numberFormat(locale);
  const hasPosts = analytics.posts.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={EyeIcon} label={t.views} value={nf.format(analytics.totals.pageviews)} />
        <MetricCard icon={UsersIcon} label={t.visitors} value={nf.format(analytics.totals.visitors)} />
        <MetricCard icon={Clock3Icon} label={t.sessions} value={nf.format(analytics.totals.sessions)} />
        <MetricCard
          icon={TimerIcon}
          label={t.averageEngagement}
          value={formatDuration(analytics.totals.avgSecondsPerPageview, locale)}
        />
      </section>

      {hasPosts ? (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{t.dailyTitle}</CardTitle>
              <CardDescription>{t.dailyDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <AnalyticsTrendChart
                days={analytics.daily}
                labels={{ visitors: t.visitors, sessions: t.sessions, pageviews: t.views }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.sourcesTitle}</CardTitle>
              <CardDescription>{t.sourcesDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.acquisition.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.source}</TableHead>
                      <TableHead className="text-end">{t.visitors}</TableHead>
                      <TableHead className="text-end">{t.views}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.acquisition.map((entry) => (
                      <TableRow key={entry.source}>
                        <TableCell>{sourceName(entry.source, locale)}</TableCell>
                        <TableCell className="text-end tabular-nums">{nf.format(entry.visitors)}</TableCell>
                        <TableCell className="text-end tabular-nums">{nf.format(entry.pageviews)}</TableCell>
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
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.postsTitle}</CardTitle>
          <CardDescription>{t.postsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {hasPosts ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.post}</TableHead>
                  <TableHead className="text-end">{t.views}</TableHead>
                  <TableHead className="text-end">{t.visitors}</TableHead>
                  <TableHead className="text-end">{t.sessions}</TableHead>
                  <TableHead className="text-end">{t.averageEngagement}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.posts.map((post) => (
                  <TableRow key={post.postId}>
                    <TableCell className="max-w-[26rem] truncate font-medium">
                      {postTitles.get(post.postId) || `#${post.postId}`}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{nf.format(post.pageviews)}</TableCell>
                    <TableCell className="text-end tabular-nums">{nf.format(post.visitors)}</TableCell>
                    <TableCell className="text-end tabular-nums">{nf.format(post.sessions)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatDuration(post.avgSecondsPerPageview, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t.empty}</p>
          )}
        </CardContent>
      </Card>

      {hasPosts ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.countriesTitle}</CardTitle>
            <CardDescription>{t.countriesDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics.countries.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.country}</TableHead>
                    <TableHead className="text-end">{t.visitors}</TableHead>
                    <TableHead className="text-end">{t.views}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.countries.map((country) => (
                    <TableRow key={country.country}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span>{flagEmoji(country.country) || country.country}</span>
                          <span>{country.country === "XX" ? "Unknown" : country.country}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{nf.format(country.visitors)}</TableCell>
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
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardDescription>{t.dataNote}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
