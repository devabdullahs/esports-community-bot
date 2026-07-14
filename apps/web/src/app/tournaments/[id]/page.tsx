import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
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
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { getViewerFollowState } from "@/lib/follows";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getRequestLocale();
  const text = copy[locale].tournaments;

  const tournamentId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) notFound();

  const [data, games] = await Promise.all([
    getTournamentMatchesCached(tournamentId),
    listGamesCached(),
  ]);
  if (!data) notFound();

  const { tournament } = data;
  if (tournament.id !== tournamentId) {
    permanentRedirect(localizedPath(`/tournaments/${tournament.id}`, locale));
  }
  const followState = await getViewerFollowState("tournament", String(tournament.id));
  const sourceUrl = safeUrlOrUndefined(tournament.url);
  const isLive = data.matches.running.length > 0;
  // Standings-format events (battle royale, TFT groups) have no head-to-head
  // matches; a 0/0/0 metric card would read like empty data. Before any results
  // land the rows are a seeded participants list rather than real standings.
  const standingsOnly = data.standings.length > 0 && data.total === 0;
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
                <DetailMetric label={text.results} value={data.matches.finished.length} locale={locale} />
              </CardContent>
            )}
          </Card>
        </div>
      </header>

      <PartnerPlacement kind="tournament" target={`tournament:${tournament.id}`} locale={locale} />

      <TournamentMatchList tournamentId={tournament.id} locale={locale} initialData={data} />

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
