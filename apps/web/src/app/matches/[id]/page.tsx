import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { CommentsSection } from "@/components/comments/comments-section";
import { MatchHeader } from "@/components/matches/match-header";
import { MatchDetailTabs } from "@/components/matches/match-detail-tabs";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { copy, localizedPath } from "@/lib/i18n";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { getMatchPageModel } from "@/lib/match-details";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";
import { isIndexableMatch } from "@/lib/seo-indexability";
import {
  breadcrumbList,
  localizedBreadcrumbLabels,
  localizedMatchDescription,
  serializeStructuredData,
  structuredDataGraph,
} from "@/lib/structured-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function indexableMatchModel(model: Awaited<ReturnType<typeof getMatchPageModel>>) {
  return Boolean(model && isIndexableMatch({
    scheduled_at: model.scheduledAt,
    team_a: model.teamA,
    team_b: model.teamB,
    has_details: Boolean(model.details),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const matchId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(matchId) || matchId <= 0) return {};
  const [model, locale, games] = await Promise.all([
    getMatchPageModel(matchId),
    getRequestLocale(),
    listGamesCached(),
  ]);
  if (!model) return {};
  const text = copy[locale].tournaments;
  const teamA = model.teamA || text.tbd;
  const teamB = model.teamB || text.tbd;
  const tournamentName = model.tournament.name || text.title;
  const gameTitle = gameTitleForSlug(model.tournament.game, games, locale);
  return buildPageMetadata({
    title: `${teamA} ${text.vs} ${teamB}`,
    description: localizedMatchDescription({
      locale,
      teamA,
      teamB,
      tournamentName,
      game: gameTitle,
    }),
    path: localizedPath(`/matches/${matchId}`, locale),
    locale,
    robots: indexableMatchModel(model) ? undefined : { index: false, follow: true },
  });
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matchId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(matchId) || matchId <= 0) notFound();

  const [model, locale] = await Promise.all([
    getMatchPageModel(matchId),
    getRequestLocale(),
  ]);
  if (!model) notFound();
  const text = copy[locale].tournaments;
  const teamA = model.teamA || text.tbd;
  const teamB = model.teamB || text.tbd;
  const tournamentName = model.tournament.name || text.title;
  const pagePath = localizedPath(`/matches/${matchId}`, locale);
  const pageUrl = absoluteUrl(pagePath);
  const tournamentUrl = absoluteUrl(
    localizedPath(`/tournaments/${model.tournament.id}`, locale),
  );
  const matchName = `${teamA} ${text.vs} ${teamB}`;
  const breadcrumbLabels = localizedBreadcrumbLabels(locale);
  const pageStructuredData = structuredDataGraph([
    breadcrumbList([
      { name: breadcrumbLabels.home, url: absoluteUrl(localizedPath("/", locale)) },
      {
        name: breadcrumbLabels.tournaments,
        url: absoluteUrl(localizedPath("/tournaments", locale)),
      },
      { name: tournamentName, url: tournamentUrl },
      { name: matchName, url: pageUrl },
    ], pageUrl),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeStructuredData(pageStructuredData) }}
      />
      <Button
        render={<Link href={localizedPath(`/tournaments/${model.tournament.id}`, locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {text.back}
      </Button>

      <MatchHeader model={model} locale={locale} liveLabel={text.live} />

      {model.details ? (
        <MatchDetailTabs details={model.details} teamA={teamA} teamB={teamB} locale={locale} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{text.matchDetails}</EmptyTitle>
            <EmptyDescription>{text.matchDetailsNoStats}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <CommentsSection target={{ type: "match", id: model.id }} locale={locale} />

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
