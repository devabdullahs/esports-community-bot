import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, TrophyIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import {
  copy,
  formatMatchStatusCount,
  formatNumber,
  formatResultCount,
  localizedPath,
} from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";
import { hasNonTrackingQuery, paginatedPath, parsePublicPage } from "@/lib/seo-query";
import { notFound } from "next/navigation";
import { listArchivedTournamentSummaries } from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const page = parsePublicPage(params.page);
  if (page === null) return { robots: { index: false, follow: true } };
  const text = copy[locale].tournaments;
  return buildPageMetadata({
    title: text.archiveTitle,
    description: text.archiveDescription,
    path: paginatedPath("/tournaments/archive", locale, page),
    locale,
    robots: hasNonTrackingQuery(params, new Set(["page"]))
      ? { index: false, follow: true }
      : undefined,
  });
}

export default async function TournamentArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ page }, locale, games] = await Promise.all([
    searchParams,
    getRequestLocale(),
    listGamesCached(),
  ]);
  const text = copy[locale].tournaments;
  const common = copy[locale].common;
  const current = parsePublicPage(page);
  if (current === null) notFound();
  const offset = (current - 1) * PAGE_SIZE;
  const fetched = await listArchivedTournamentSummaries({ limit: PAGE_SIZE + 1, offset });
  const tournaments = fetched.slice(0, PAGE_SIZE);
  if (current > 1 && tournaments.length === 0) notFound();
  const hasNext = fetched.length > PAGE_SIZE;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: text.title, href: localizedPath("/tournaments", locale) },
          { label: text.archiveTitle },
        ]}
      />

      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <ArchiveIcon data-icon="inline-start" />
          {text.archivedBadge}
        </Badge>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{text.archiveTitle}</h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">{text.archiveDescription}</p>
        </div>
        <Button
          render={<Link href={localizedPath("/tournaments", locale)} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
          {text.activeLink}
        </Button>
      </section>

      {tournaments.length ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((tournament) => {
            const title = tournament.name || `#${formatNumber(tournament.id, locale)}`;
            const gameTitle = gameTitleForSlug(tournament.game ?? "other", games, locale);
            const finishedAt = tournament.last_match_at ?? tournament.archived_at ?? null;
            return (
              <Link
                key={tournament.id}
                href={localizedPath(`/tournaments/${tournament.id}`, locale)}
                className="group block"
              >
                <Card
                  size="sm"
                  className="h-full ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40"
                >
                  <CardHeader>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="w-fit">
                        <TrophyIcon data-icon="inline-start" />
                        {gameTitle}
                      </Badge>
                      <Badge variant="outline" className="w-fit">
                        {text.archivedBadge}
                      </Badge>
                    </div>
                    <CardTitle dir="auto" className="line-clamp-2">
                      {title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
                    <div className="flex flex-wrap gap-2">
                      {tournament.matchCounts.finished > 0 ? (
                        <span>{formatResultCount(tournament.matchCounts.finished, locale)}</span>
                      ) : null}
                      {tournament.matchCounts.scheduled > 0 ? (
                        <span>{formatMatchStatusCount(tournament.matchCounts.scheduled, "upcoming", locale)}</span>
                      ) : null}
                    </div>
                    {finishedAt ? (
                      <p>
                        {text.finished}:{" "}
                        <DateTime
                          value={new Date(finishedAt * 1000).toISOString()}
                          locale={locale}
                        />
                      </p>
                    ) : null}
                    <span className="inline-flex items-center gap-1 text-primary">
                      {text.viewMatches}
                      <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{text.archiveEmpty}</p>
      )}

      {current > 1 || hasNext ? (
        <nav className="grid gap-3 sm:flex sm:items-center sm:justify-between">
          {current > 1 ? (
            <Link
              href={localizedPath(`/tournaments/archive?page=${current - 1}`, locale)}
              className="rounded-md border px-3 py-2 text-center text-sm font-medium text-primary hover:bg-muted/40"
            >
              {common.newer}
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {hasNext ? (
            <Link
              href={localizedPath(`/tournaments/archive?page=${current + 1}`, locale)}
              className="rounded-md border px-3 py-2 text-center text-sm font-medium text-primary hover:bg-muted/40"
            >
              {common.older}
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
        </nav>
      ) : null}

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
