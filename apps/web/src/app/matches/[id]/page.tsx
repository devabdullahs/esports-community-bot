import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { MatchHeader } from "@/components/matches/match-header";
import { MatchDetailTabs } from "@/components/matches/match-detail-tabs";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { copy, localizedPath } from "@/lib/i18n";
import { getMatchPageModel } from "@/lib/match-details";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const matchId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(matchId) || matchId <= 0) return {};
  const [model, locale] = await Promise.all([getMatchPageModel(matchId), getRequestLocale()]);
  if (!model) return {};
  return buildPageMetadata({
    title: `${model.teamA ?? "TBD"} vs ${model.teamB ?? "TBD"}`,
    description: copy[locale].tournaments.matchDetails,
    path: localizedPath(`/matches/${matchId}`, locale),
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

  const [model, locale] = await Promise.all([getMatchPageModel(matchId), getRequestLocale()]);
  if (!model) notFound();
  const text = copy[locale].tournaments;
  const teamA = model.teamA || text.tbd;
  const teamB = model.teamB || text.tbd;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
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

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
