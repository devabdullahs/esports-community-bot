import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, AwardIcon, CircleDotIcon, TrophyIcon } from "lucide-react";
import { getPublicEwcPredictorProfile } from "@bot/lib/ewcProfileStats.js";
import { PredictionAchievementBadges } from "@/components/predictions/prediction-achievement-badges";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentSeason } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";
import { buildPageMetadata } from "@/lib/metadata";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import {
  scoreBreakdownStatusKey,
  type PredictionBreakdown,
  type PredictionBreakdownRow,
} from "@/lib/prediction-breakdown-model";
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
  scoreSources: Array<{
    key: string;
    label: string;
    kind: "weekly" | "season";
    points: number;
    provisional: boolean;
    breakdown: PredictionBreakdown | null;
  }>;
  recentFinalizedResults: Array<{
    weekKey: string;
    label: string;
    score: number;
    bonus: number;
    rank: number | null;
    winner: boolean;
  }>;
};

function breakdownRowName(
  row: PredictionBreakdownRow,
  index: number,
  breakdown: PredictionBreakdown | null,
  locale: "en" | "ar",
) {
  if (breakdown?.kind === "weekly-per-game") {
    return row.game || `${copy[locale].profile.scoreDetails} ${formatNumber(index + 1, locale)}`;
  }
  if (breakdown?.kind === "season") {
    return `${copy[locale].profile.scorePick} #${formatNumber(row.predictedRank || index + 1, locale)}`;
  }
  return `${copy[locale].profile.scorePick} ${formatNumber(index + 1, locale)}`;
}

function breakdownRowPick(row: PredictionBreakdownRow) {
  return row.pick || row.matchedClub || row.matchedTeam || "-";
}

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
    { label: profile.finalizedWeeks, value: formatNumber(predictor.weeks, locale) },
    { label: profile.weeklyWins, value: formatNumber(predictor.wins, locale) },
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

      <section className="flex flex-col gap-3" aria-labelledby="predictor-points">
        <div className="flex items-center gap-2">
          <CircleDotIcon className="size-5 text-muted-foreground" />
          <h2 id="predictor-points" className="text-xl font-semibold">{profile.pointsBreakdown}</h2>
        </div>
        {predictor.scoreSources.length ? (
          <Card>
            <CardContent className="p-0">
              <Accordion defaultValue={predictor.scoreSources[0]?.key ? [predictor.scoreSources[0].key] : []}>
                {predictor.scoreSources.map((source) => (
                  <AccordionItem key={source.key} value={source.key}>
                    <AccordionTrigger className="px-4 py-3 hover:no-underline sm:px-5">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 pe-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium" dir="auto">{source.label}</span>
                          <Badge variant={source.provisional ? "secondary" : "outline"}>
                            {source.provisional ? profile.provisional : source.kind === "season" ? profile.seasonResult : profile.finalized}
                          </Badge>
                        </div>
                        <span className="font-semibold tabular-nums">
                          {source.points >= 0 ? "+" : ""}{formatNumber(source.points, locale)} {text.common.points.toLowerCase()}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-0">
                      {source.breakdown?.available ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{text.profiles.game}</TableHead>
                              <TableHead>{text.profile.scorePick}</TableHead>
                              <TableHead>{text.profiles.status}</TableHead>
                              <TableHead className="text-end">{text.common.points}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {source.breakdown.rows.map((row, index) => (
                              <TableRow key={`${row.game || row.pick || "score"}-${index}`}>
                                <TableCell className="max-w-72 whitespace-normal font-medium" dir="auto">
                                  {breakdownRowName(row, index, source.breakdown, locale)}
                                </TableCell>
                                <TableCell className="max-w-56 whitespace-normal" dir="auto">
                                  <div className="flex flex-col gap-1">
                                    <span>{breakdownRowPick(row)}</span>
                                    {row.placement ? (
                                      <span className="text-xs text-muted-foreground">
                                        {text.profile.scorePlacement}: {row.placement}
                                      </span>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">
                                    {text.profile.scoreStatus[scoreBreakdownStatusKey(row.status)]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-end font-semibold tabular-nums">
                                  {row.points >= 0 ? "+" : ""}{formatNumber(row.points, locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                            {source.breakdown.bonus ? (
                              <TableRow>
                                <TableCell colSpan={3} className="font-medium">{profile.bonus}</TableCell>
                                <TableCell className="text-end font-semibold tabular-nums">
                                  +{formatNumber(source.breakdown.bonus, locale)}
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">
                          {text.profile.scoreDetailsUnavailable}
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">{profile.noPointSources}</p>
        )}
        {predictor.scoreSources.some((source) => source.provisional) ? (
          <p className="text-sm leading-6 text-muted-foreground">{profile.provisionalHint}</p>
        ) : null}
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
                    {result.winner ? <Badge variant="default">{profile.weeklyWinner}</Badge> : null}
                    {result.rank ? <span>{text.common.rank}: #{formatNumber(result.rank, locale)}</span> : null}
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
