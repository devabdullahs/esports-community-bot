import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon, CrownIcon, TrophyIcon, UsersRoundIcon } from "lucide-react";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
import { PartnerPlacement } from "@/components/partners/partner-placement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  copy,
  formatNumber,
  localizedPath,
} from "@/lib/i18n";
import {
  getLeaderboardPageModel,
  getLeaderboardPageRequest,
} from "@/lib/leaderboard-page-model";
import { getRequestLocale } from "@/lib/request-locale";
import { getPublicEwcLeaderboardCached, isKnownEwcLeaderboardNamespace } from "@/lib/public-ewc-leaderboard";
import { buildPageMetadata } from "@/lib/metadata";
import { hasNonTrackingQuery, paginatedPath, parsePublicPage } from "@/lib/seo-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string; season: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { guildId, season } = await params;
  const query = await searchParams;
  const page = parsePublicPage(query.page);
  if (page === null) return { robots: { index: false, follow: true } };
  const locale = await getRequestLocale();
  const text = copy[locale];
  return buildPageMetadata({
    title: text.leaderboard.title(season),
    description: text.leaderboard.badge,
    path: paginatedPath(`/leaderboard/${guildId}/${season}`, locale, page),
    locale,
    robots: hasNonTrackingQuery(query, new Set(["page"]))
      ? { index: false, follow: true }
      : undefined,
  });
}

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string; season: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guildId, season } = await params;
  const query = await searchParams;
  const requestedPage = parsePublicPage(query.page);
  if (requestedPage === null) notFound();
  const locale = await getRequestLocale();
  const text = copy[locale];

  const initialRequest = getLeaderboardPageRequest(requestedPage);
  if (!(await isKnownEwcLeaderboardNamespace(guildId, season))) notFound();
  let leaderboard = await getPublicEwcLeaderboardCached({
    guildId,
    season,
    limit: initialRequest.limit,
    offset: initialRequest.offset,
  });
  let pageModel = getLeaderboardPageModel({
    requestedPage,
    total: leaderboard.total,
    returnedRowCount: leaderboard.rows.length,
  });

  // Once the total is known, only an over-range URL needs a corrected fetch.
  if (pageModel.offset !== initialRequest.offset) {
    leaderboard = await getPublicEwcLeaderboardCached({
      guildId,
      season,
      limit: pageModel.limit,
      offset: pageModel.offset,
    });
    pageModel = getLeaderboardPageModel({
      requestedPage,
      total: leaderboard.total,
      returnedRowCount: leaderboard.rows.length,
    });
  }
  if (pageModel.page !== requestedPage) {
    redirect(
      paginatedPath(`/leaderboard/${guildId}/${season}`, locale, pageModel.page),
    );
  }
  // "Top score" is the global #1 — always from page 1, not the current page's first row.
  const topScore = leaderboard.topScore ?? leaderboard.rows[0]?.overallPoints ?? 0;
  const leaderboardPath = `/leaderboard/${guildId}/${season}`;
  const pageHref = (targetPage: number) => paginatedPath(leaderboardPath, locale, targetPage);

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10"
    >
      <Button
        render={<Link href={localizedPath("/", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.leaderboard.back}
      </Button>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-4">
          <Badge variant="outline">
            <TrophyIcon data-icon="inline-start" />
            {text.leaderboard.badge}
          </Badge>
          <div className="flex max-w-3xl flex-col gap-3">
            <h1 className="text-3xl font-semibold leading-tight text-balance sm:text-4xl">
              {text.leaderboard.title(season)}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {text.leaderboard.description(leaderboard.total)}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryMetric
            icon={UsersRoundIcon}
            label={text.leaderboard.rankedMembers}
            value={formatNumber(leaderboard.total, locale)}
          />
          <SummaryMetric
            icon={CrownIcon}
            label={text.leaderboard.topScore}
            value={formatNumber(topScore, locale)}
          />
          <SummaryMetric
            icon={TrophyIcon}
            label={text.common.season}
            value={season}
          />
        </div>
      </section>

      <PartnerPlacement kind="leaderboard" target={`season:${season}`} locale={locale} />

      <Card>
        <CardHeader>
          <CardTitle>{text.common.publicLeaderboard}</CardTitle>
          <CardDescription>{text.leaderboard.description(leaderboard.total)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LeaderboardTable rows={leaderboard.rows} locale={locale} />
          {leaderboard.total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                {text.leaderboard.showing(pageModel.rangeStart, pageModel.rangeEnd, leaderboard.total)}
              </p>
              {pageModel.totalPages > 1 ? (
                <div className="flex gap-2">
                  {pageModel.hasPreviousPage ? (
                    <Button
                      render={<Link href={pageHref(pageModel.page - 1)} />}
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                    >
                      <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
                      {text.common.previous}
                    </Button>
                  ) : null}
                  {pageModel.hasNextPage ? (
                    <Button
                      render={<Link href={pageHref(pageModel.page + 1)} />}
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                    >
                      {text.common.next}
                      <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TrophyIcon;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon className="text-muted-foreground" />
        </CardAction>
        <CardTitle className="truncate text-2xl font-semibold tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
