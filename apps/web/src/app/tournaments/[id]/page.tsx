import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon, RadioIcon } from "lucide-react";
import { TournamentMark } from "@/components/tournaments/tournament-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { TournamentMatchList } from "@/components/tournaments/tournament-match-list";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { getTournamentMatchesCached } from "@/lib/tournaments";
import { buildPageMetadata } from "@/lib/metadata";
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
  const [data, locale] = await Promise.all([
    getTournamentMatchesCached(tournamentId),
    getRequestLocale(),
  ]);
  if (!data) return {};
  return buildPageMetadata({
    title: data.tournament.name || `#${id}`,
    description: copy[locale].tournaments.description,
    path: localizedPath(`/tournaments/${id}`, locale),
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
  const sourceUrl = safeUrlOrUndefined(tournament.url);
  const isLive = data.matches.running.length > 0;
  const gameTitle = tournament.game
    ? gameTitleForSlug(tournament.game, games, locale)
    : text.allGames;
  const sourceName = sourceLabel(tournament.source);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
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
            <TournamentMark
              slug={tournament.game ?? "other"}
              source={tournament.source}
            />
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
                {tournament.name || `#${formatNumber(tournament.id, locale)}`}
              </h1>
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
          <Card className="min-w-0 bg-background/35 py-0 lg:w-80">
            <CardContent className="grid grid-cols-3 gap-2 p-3">
              <DetailMetric label={text.live} value={data.matches.running.length} locale={locale} live />
              <DetailMetric label={text.upcoming} value={data.matches.scheduled.length} locale={locale} />
              <DetailMetric label={text.results} value={data.matches.finished.length} locale={locale} />
            </CardContent>
          </Card>
        </div>
      </header>

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
      <div className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">{label}</div>
    </div>
  );
}
