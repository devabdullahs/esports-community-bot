import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, AwardIcon, TrophyIcon } from "lucide-react";
import { getPublicEwcPredictorProfile } from "@bot/lib/ewcProfileStats.js";
import { PredictionAchievementBadges } from "@/components/predictions/prediction-achievement-badges";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentSeason } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";
import { buildPageMetadata } from "@/lib/metadata";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicPredictor = {
  displayName: string;
  avatarUrl: string | null;
  rank: number;
  points: number;
  weeks: number;
  wins: number;
  sweeps: number;
  achievements: string[];
  recentFinalizedResults: Array<{
    weekKey: string;
    label: string;
    score: number;
    bonus: number;
  }>;
};

async function getPredictor(id: string): Promise<PublicPredictor | null> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return null;
  return getPublicEwcPredictorProfile({ publicId: id, guildId, season: currentSeason() }) as Promise<PublicPredictor | null>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const [{ id }, locale] = await Promise.all([params, getRequestLocale()]);
  const predictor = await getPredictor(id);
  if (!predictor) return { robots: { index: false, follow: true } };
  const text = copy[locale].predictor;
  return buildPageMetadata({
    title: text.title(predictor.displayName),
    description: text.description,
    path: localizedPath(`/predictors/${id}`, locale),
    locale,
  });
}

export default async function PublicPredictorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, locale] = await Promise.all([params, getRequestLocale()]);
  const predictor = await getPredictor(id);
  if (!predictor) notFound();

  const text = copy[locale];
  const profile = text.predictor;
  const metrics = [
    { label: text.common.rank, value: `#${formatNumber(predictor.rank, locale)}` },
    { label: text.common.points, value: formatNumber(predictor.points, locale) },
    { label: text.common.weeks, value: formatNumber(predictor.weeks, locale) },
    { label: text.common.wins, value: formatNumber(predictor.wins, locale) },
    { label: text.common.sweeps, value: formatNumber(predictor.sweeps, locale) },
  ];

  return (
    <main
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10"
    >
      <Button
        render={<Link href={localizedPath("/leaderboard", locale)} />}
        nativeButton={false}
        variant="ghost"
        className="w-fit"
      >
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {profile.back}
      </Button>

      <section className="flex flex-col gap-5">
        <Badge variant="outline" className="w-fit">
          <TrophyIcon data-icon="inline-start" />
          {profile.badge}
        </Badge>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="size-16">
            <AvatarImage src={predictor.avatarUrl || undefined} alt="" />
            <AvatarFallback>{predictor.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-semibold leading-tight sm:text-4xl" dir="auto">
              {profile.title(predictor.displayName)}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{profile.description}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label={profile.badge}>
        {metrics.map((metric) => (
          <Card key={metric.label} size="sm">
            <CardHeader>
              <CardDescription>{metric.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">{metric.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="predictor-achievements">
        <div className="flex items-center gap-2">
          <AwardIcon className="size-5 text-muted-foreground" />
          <h2 id="predictor-achievements" className="text-xl font-semibold">{text.profile.achievements}</h2>
        </div>
        {predictor.achievements.length ? (
          <PredictionAchievementBadges achievementIds={predictor.achievements} locale={locale} showLabels />
        ) : (
          <p className="text-sm text-muted-foreground">{text.profile.noAchievements}</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="predictor-results">
        <h2 id="predictor-results" className="text-xl font-semibold">{profile.recentResults}</h2>
        {predictor.recentFinalizedResults.length ? (
          <Card>
            <CardContent className="divide-y p-0">
              {predictor.recentFinalizedResults.map((result) => (
                <div key={result.weekKey} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <p className="font-medium" dir="auto">{result.label}</p>
                  <div className="flex items-center gap-4 text-sm tabular-nums text-muted-foreground">
                    <span>{profile.score}: {formatNumber(result.score, locale)}</span>
                    {result.bonus > 0 ? <span>{profile.bonus}: {formatNumber(result.bonus, locale)}</span> : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">{profile.noRecentResults}</p>
        )}
      </section>
    </main>
  );
}
