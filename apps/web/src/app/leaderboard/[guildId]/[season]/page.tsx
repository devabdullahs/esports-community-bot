import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, CrownIcon, TrophyIcon, UsersRoundIcon } from "lucide-react";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
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
import { getRequestLocale } from "@/lib/request-locale";
import { getPublicEwcLeaderboardCached } from "@/lib/public-ewc-leaderboard";
import { buildPageMetadata } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guildId: string; season: string }>;
}): Promise<Metadata> {
  const { guildId, season } = await params;
  const locale = await getRequestLocale();
  const text = copy[locale];
  return buildPageMetadata({
    title: text.leaderboard.title(season),
    description: text.leaderboard.badge,
    path: localizedPath(`/leaderboard/${guildId}/${season}`, locale),
  });
}

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string; season: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { guildId, season } = await params;
  const requestedPage = Math.max(1, Math.floor(Number((await searchParams).page)) || 1);
  const locale = await getRequestLocale();
  const text = copy[locale];

  // Server pagination so ranks past the first page are reachable. The table keeps
  // its in-page search/sort; this nav steps between 100-rank blocks.
  let page = requestedPage;
  let leaderboard = await getPublicEwcLeaderboardCached({
    guildId,
    season,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(leaderboard.total / PAGE_SIZE));
  if (page > totalPages) {
    page = totalPages;
    leaderboard = await getPublicEwcLeaderboardCached({
      guildId,
      season,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  }
  // "Top score" is the global #1 — always from page 1, not the current page's first row.
  const topScore =
    page === 1
      ? leaderboard.rows[0]?.overallPoints || 0
      : (await getPublicEwcLeaderboardCached({ guildId, season, limit: 1, offset: 0 })).rows[0]
          ?.overallPoints || 0;
  const rangeStart = leaderboard.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = (page - 1) * PAGE_SIZE + leaderboard.rows.length;

  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8"
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

      <Card>
        <CardHeader>
          <CardTitle>{text.common.publicLeaderboard}</CardTitle>
          <CardDescription>{text.leaderboard.description(leaderboard.total)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LeaderboardTable rows={leaderboard.rows} locale={locale} />
          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                {text.leaderboard.showing(rangeStart, rangeEnd, leaderboard.total)}
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Button
                    render={<Link href={`?page=${page - 1}`} />}
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                  >
                    <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
                    {text.common.previous}
                  </Button>
                ) : null}
                {page < totalPages ? (
                  <Button
                    render={<Link href={`?page=${page + 1}`} />}
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                  >
                    {text.common.next}
                    <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
                  </Button>
                ) : null}
              </div>
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
