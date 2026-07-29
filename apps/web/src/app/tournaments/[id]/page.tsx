import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon, RadioIcon } from "lucide-react";
import { FollowButton } from "@/components/follows/follow-button";
import { TournamentMark } from "@/components/tournaments/tournament-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { PartnerPlacement } from "@/components/partners/partner-placement";
import { TournamentMatchList } from "@/components/tournaments/tournament-match-list";
import { TournamentSyncHealthStatus } from "@/components/tournaments/tournament-sync-health";
import { OfficialTournamentAttribution } from "@/components/tournaments/official-tournament-attribution";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { getViewerFollowState } from "@/lib/follows";
import { getViewerMatchReminderState } from "@/lib/match-reminders";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { getTournamentMatchesCached } from "@/lib/tournaments";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import {
  breadcrumbList,
  localizedBreadcrumbLabels,
  localizedTournamentDescription,
  serializeStructuredData,
  structuredDataGraph,
} from "@/lib/structured-data";
import { sourceLabel } from "@/lib/tournament-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_PAGE_SIZE = 50;

type TournamentSearchParams = Record<string, string | string[] | undefined>;

function parseResultsPage(searchParams: TournamentSearchParams): number {
  const raw = Array.isArray(searchParams.resultsPage)
    ? searchParams.resultsPage[0]
    : searchParams.resultsPage;
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function resultsPageHref({
  tournamentId,
  locale,
  searchParams,
  page,
}: {
  tournamentId: number;
  locale: "en" | "ar";
  searchParams: TournamentSearchParams;
  page: number;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "resultsPage" || value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
  if (page > 1) params.set("resultsPage", String(page));
  const query = params.toString();
  const pathname = localizedPath(`/tournaments/${tournamentId}`, locale);
  return `${pathname}${query ? `?${query}` : ""}#results`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tournamentId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) return {};
  const [data, locale, games] = await Promise.all([
    getTournamentMatchesCached(tournamentId),
    getRequestLocale(),
    listGamesCached(),
  ]);
  if (!data) return {};
  const name = data.tournament.name || `#${id}`;
  const gameTitle = gameTitleForSlug(data.tournament.game, games, locale);
  return buildPageMetadata({
    title: name,
    description: localizedTournamentDescription({ locale, name, game: gameTitle }),
    path: localizedPath(`/tournaments/${data.tournament.id}`, locale),
  });
}

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<TournamentSearchParams>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const locale = await getRequestLocale();
  const text = copy[locale].tournaments;

  const tournamentId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) notFound();

  const resultsPage = parseResultsPage(resolvedSearchParams);
  const finishedOffset = (resultsPage - 1) * RESULTS_PAGE_SIZE;
  const [data, games] = await Promise.all([
    getTournamentMatchesCached(tournamentId, {
      limit: RESULTS_PAGE_SIZE,
      offset: finishedOffset,
      includeBracket: true,
    }),
    listGamesCached(),
  ]);
  if (!data) notFound();

  const { tournament } = data;
  if (tournament.id !== tournamentId) {
    permanentRedirect(localizedPath(`/tournaments/${tournament.id}`, locale));
  }
  const lastResultsPage = Math.max(1, Math.ceil(data.totals.finished / RESULTS_PAGE_SIZE));
  if (resultsPage > lastResultsPage) {
    redirect(resultsPageHref({
      tournamentId: tournament.id,
      locale,
      searchParams: resolvedSearchParams,
      page: lastResultsPage,
    }));
  }
  const currentResultsHref = resultsPageHref({
    tournamentId: tournament.id,
    locale,
    searchParams: resolvedSearchParams,
    page: resultsPage,
  });
  const reminderMatchIds = data.matches.scheduled.map((match) => match.id);
  const [followState, reminderState] = await Promise.all([
    getViewerFollowState("tournament", String(tournament.id)),
    getViewerMatchReminderState(reminderMatchIds),
  ]);
  const sourceUrl = safeUrlOrUndefined(tournament.url);
  const isLive = data.matches.running.length > 0;
  // Standings-format events (battle royale, TFT groups) have no head-to-head
  // matches; a 0/0/0 metric card would read like empty data. Before any results
  // land the rows are a seeded participants list rather than real standings.
  const standingsOnly = data.standings.length > 0 && data.totals.all === 0;
  const standingsHaveResults = data.standings.some(
    (s) => /[1-9]/.test(String(s.points ?? "")) || /[1-9]/.test(String(s.extra ?? "")),
  );
  const gameTitle = tournament.game
    ? gameTitleForSlug(tournament.game, games, locale)
    : text.allGames;
  const sourceName = sourceLabel(tournament.source);
  const tournamentName = tournament.name || `#${formatNumber(tournament.id, locale)}`;
  const pagePath = localizedPath(`/tournaments/${tournament.id}`, locale);
  const pageUrl = absoluteUrl(pagePath);
  const breadcrumbLabels = localizedBreadcrumbLabels(locale);
  const pageStructuredData = structuredDataGraph([
    breadcrumbList([
      { name: breadcrumbLabels.home, url: absoluteUrl(localizedPath("/", locale)) },
      {
        name: breadcrumbLabels.tournaments,
        url: absoluteUrl(localizedPath("/tournaments", locale)),
      },
      { name: tournamentName, url: pageUrl },
    ], pageUrl),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeStructuredData(pageStructuredData) }}
      />
      <Button
        render={<Link href={localizedPath("/tournaments", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.back}
      </Button>

      <header className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
            <TournamentMark slug={tournament.game ?? "other"} />
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{gameTitle}</Badge>
                <Badge variant="outline">{sourceName}</Badge>
                {isLive ? (
                  <Badge variant="destructive">
                    <RadioIcon data-icon="inline-start" />
                    {text.live}
                  </Badge>
                ) : null}
              </div>
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl" dir="auto">
                {tournamentName}
              </h1>
              <TournamentSyncHealthStatus tournamentId={tournament.id} locale={locale} initialData={data} />
              <div className="flex flex-wrap items-center gap-2">
                <FollowButton
                  entityType="tournament"
                  entityKey={String(tournament.id)}
                  entityLabel={tournament.name || `#${tournament.id}`}
                  entityRef={`/tournaments/${tournament.id}`}
                  signedIn={followState.signedIn}
                  initialFollowing={followState.following}
                  locale={locale}
                  callbackPath={localizedPath(`/tournaments/${tournament.id}`, locale)}
                />
                {sourceUrl ? (
                  <Button
                    render={<a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow" />}
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                    className="w-fit"
                  >
                    {text.openSource}
                    <ExternalLinkIcon data-icon="inline-end" />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <Card className="min-w-0 bg-background/35 py-0 lg:w-72 lg:shrink-0 xl:w-80">
            {standingsOnly ? (
              <CardContent className="grid grid-cols-1 gap-2 p-3">
                <DetailMetric
                  label={standingsHaveResults ? text.standings : text.participants}
                  value={data.standings.length}
                  locale={locale}
                />
              </CardContent>
            ) : (
              <CardContent className="grid grid-cols-3 gap-2 p-3">
                <DetailMetric label={text.live} value={data.matches.running.length} locale={locale} live />
                <DetailMetric label={text.upcoming} value={data.matches.scheduled.length} locale={locale} />
                <DetailMetric label={text.results} value={data.totals.finished} locale={locale} />
              </CardContent>
            )}
          </Card>
        </div>
      </header>

      {data.overview ? (
        <section className="flex flex-col gap-4" aria-labelledby="tournament-overview-heading">
          <h2 id="tournament-overview-heading" className="text-xl font-semibold">
            {locale === "ar" ? "معلومات البطولة" : "Tournament information"}
          </h2>
          {data.overview.facts.length ? (
            <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
              {data.overview.facts.map((fact) => (
                <div key={`${fact.label}-${fact.value}`} className="grid gap-1 bg-card p-4">
                  <dt className="text-xs font-medium text-muted-foreground" dir="auto">{fact.label}</dt>
                  <dd className="font-medium" dir="auto">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {data.overview.sections.map((section) => (
            <details key={section.title} className="overflow-hidden rounded-xl border">
              <summary className="cursor-pointer px-4 py-3 font-semibold" dir="auto">
                {section.title}
              </summary>
              <div className="overflow-x-auto border-t">
                <table className="w-full min-w-[42rem] text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      {section.columns.map((column) => (
                        <th key={column} className="px-4 py-3 text-start" dir="auto">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.entries.map((entry, index) => (
                      <tr key={`${section.title}-${index}`} className="border-t">
                        {section.columns.map((column) => (
                          <td key={column} className="px-4 py-3" dir="auto">{entry[column] ?? "-"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </section>
      ) : null}

      <PartnerPlacement kind="tournament" target={`tournament:${tournament.id}`} locale={locale} />

      <TournamentMatchList
        tournamentId={tournament.id}
        locale={locale}
        initialData={data}
        reminderState={reminderState}
        callbackPath={currentResultsHref.replace(/#results$/, "")}
        resultsNavigation={{
          newestHref: resultsPageHref({
            tournamentId: tournament.id,
            locale,
            searchParams: resolvedSearchParams,
            page: 1,
          }),
          previousHref: resultsPage > 1
            ? resultsPageHref({
                tournamentId: tournament.id,
                locale,
                searchParams: resolvedSearchParams,
                page: resultsPage - 1,
              })
            : null,
          nextHref: data.finishedPage.hasMore
            ? resultsPageHref({
                tournamentId: tournament.id,
                locale,
                searchParams: resolvedSearchParams,
                page: resultsPage + 1,
              })
            : null,
        }}
      />

      <OfficialTournamentAttribution value={data.overview?.attribution} />
      <LiquipediaAttribution locale={locale} />
    </main>
  );
}

function DetailMetric({
  label,
  value,
  locale,
  live,
}: {
  label: string;
  value: number;
  locale: "en" | "ar";
  live?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/35 px-2 py-2 text-center">
      <div
        className={
          live && value > 0
            ? "text-lg font-semibold tabular-nums text-destructive"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {formatNumber(value, locale)}
      </div>
      <div className="mt-0.5 text-[0.68rem] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}
