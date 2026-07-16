import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CircleDashedIcon,
  Clock3Icon,
  TargetIcon,
  TrophyIcon,
  UserRoundIcon,
} from "lucide-react";
import { DateTime } from "@/components/date-time";
import { PartnerPlacement } from "@/components/partners/partner-placement";
import { PickDistributionPanel } from "@/components/predictions/pick-distribution";
import { PredictionPickerEntry } from "@/components/predictions/prediction-picker-entry";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getPredictionPickDistributions } from "@/lib/prediction-pick-distribution";
import { getPublicPredictionStatus } from "@/lib/public-prediction-status";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    eyebrow: "Predictions",
    title: "EWC prediction boards",
    description:
      "Make your picks in Discord, then track the current round, your score, and the community leaderboard here.",
    currentRound: "Current round",
    activeRounds: "Open rounds",
    open: "Predictions are open",
    upcoming: "Next round",
    awaiting: "Awaiting scoring",
    idle: "No active prediction round",
    idleDescription: "The next EWC prediction round will appear here when it is scheduled.",
    roundProgress: "Round progress",
    openGames: (count: number) => `${count} games open`,
    lockedGames: (count: number) => `${count} locked`,
    closes: "Closes",
    opens: "Opens",
    scoring: "Results are being finalized",
    nextLock: "Next lock",
    games: (count: number) => `${count} games`,
    profileTitle: "Your prediction profile",
    profileDescription: "See your remaining picks, rank, points, and weekly history.",
    openProfile: "Open my profile",
    leaderboardTitle: "Public leaderboard",
    leaderboardDescription: "Browse the community's full prediction ranking for the season.",
    openLeaderboard: "Open leaderboard",
  },
  ar: {
    eyebrow: "\u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a",
    title: "\u0644\u0648\u062d\u0627\u062a \u062a\u0648\u0642\u0639\u0627\u062a \u0643\u0623\u0633 \u0627\u0644\u0639\u0627\u0644\u0645 \u0644\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
    description:
      "\u0642\u062f\u0651\u0645 \u062a\u0648\u0642\u0639\u0627\u062a\u0643 \u0639\u0628\u0631 \u062f\u064a\u0633\u0643\u0648\u0631\u062f\u060c \u062b\u0645 \u062a\u0627\u0628\u0639 \u0627\u0644\u062c\u0648\u0644\u0629 \u0627\u0644\u062d\u0627\u0644\u064a\u0629 \u0648\u0646\u0642\u0627\u0637\u0643 \u0648\u062a\u0631\u062a\u064a\u0628 \u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u0647\u0646\u0627.",
    currentRound: "\u0627\u0644\u062c\u0648\u0644\u0629 \u0627\u0644\u062d\u0627\u0644\u064a\u0629",
    activeRounds: "\u0627\u0644\u062c\u0648\u0644\u0627\u062a \u0627\u0644\u0645\u0641\u062a\u0648\u062d\u0629",
    open: "\u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a \u0645\u0641\u062a\u0648\u062d\u0629",
    upcoming: "\u0627\u0644\u062c\u0648\u0644\u0629 \u0627\u0644\u0642\u0627\u062f\u0645\u0629",
    awaiting: "\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u062d\u062a\u0633\u0627\u0628 \u0627\u0644\u0646\u062a\u0627\u0626\u062c",
    idle: "\u0644\u0627 \u062a\u0648\u062c\u062f \u062c\u0648\u0644\u0629 \u062a\u0648\u0642\u0639\u0627\u062a \u0646\u0634\u0637\u0629",
    idleDescription: "\u0633\u062a\u0638\u0647\u0631 \u062c\u0648\u0644\u0629 EWC \u0627\u0644\u0642\u0627\u062f\u0645\u0629 \u0647\u0646\u0627 \u0639\u0646\u062f \u062c\u062f\u0648\u0644\u062a\u0647\u0627.",
    roundProgress: "\u062a\u0642\u062f\u0645 \u0627\u0644\u062c\u0648\u0644\u0629",
    openGames: (count: number) => `${count} \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0645\u0641\u062a\u0648\u062d\u0629`,
    lockedGames: (count: number) => `${count} \u0645\u063a\u0644\u0642\u0629`,
    closes: "\u064a\u0646\u062a\u0647\u064a",
    opens: "\u064a\u0641\u062a\u062d",
    scoring: "\u062c\u0627\u0631\u064d \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u0646\u062a\u0627\u0626\u062c",
    nextLock: "\u0627\u0644\u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0642\u0627\u062f\u0645",
    games: (count: number) => `${count} \u0645\u0628\u0627\u0631\u064a\u0627\u062a`,
    profileTitle: "\u0645\u0644\u0641 \u062a\u0648\u0642\u0639\u0627\u062a\u0643",
    profileDescription: "\u062a\u0627\u0628\u0639 \u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a\u0643 \u0627\u0644\u0645\u062a\u0628\u0642\u064a\u0629 \u0648\u062a\u0631\u062a\u064a\u0628\u0643 \u0648\u0646\u0642\u0627\u0637\u0643 \u0648\u0633\u062c\u0644\u0643 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064a.",
    openProfile: "\u0627\u0641\u062a\u062d \u0645\u0644\u0641\u064a",
    leaderboardTitle: "\u0644\u0648\u062d\u0629 \u0627\u0644\u0635\u062f\u0627\u0631\u0629 \u0627\u0644\u0639\u0627\u0645\u0629",
    leaderboardDescription: "\u062a\u0635\u0641\u0651\u062d \u062a\u0631\u062a\u064a\u0628 \u062a\u0648\u0642\u0639\u0627\u062a \u0627\u0644\u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0643\u0627\u0645\u0644 \u0644\u0644\u0645\u0648\u0633\u0645.",
    openLeaderboard: "\u0627\u0641\u062a\u062d \u0644\u0648\u062d\u0629 \u0627\u0644\u0635\u062f\u0627\u0631\u0629",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = COPY[locale];
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/predictions", locale),
    locale,
  });
}

export default async function PredictionsPage() {
  const locale = await getRequestLocale();
  const t = COPY[locale];
  const status = await getPublicPredictionStatus().catch(() => ({
    guildId: null,
    season: "2026",
    state: "idle" as const,
    round: null,
    rounds: [],
    upcomingRounds: [],
    awaitingRounds: [],
  }));
  const leaderboardHref = localizedPath("/leaderboard", locale);
  const pickDistributions = await getPredictionPickDistributions(status.guildId, status.awaitingRounds).catch(() => new Map());
  const round = status.round;
  const stateLabel =
    status.state === "open"
      ? t.open
      : status.state === "upcoming"
        ? t.upcoming
        : status.state === "awaiting-scoring"
          ? t.awaiting
          : t.idle;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <TargetIcon data-icon="inline-start" />
          {t.eyebrow}
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{t.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">{t.description}</p>
      </section>

      <PartnerPlacement kind="predictions" locale={locale} />

      <Card>
        <CardHeader>
          <CardTitle>{status.rounds.length ? t.activeRounds : round?.label || t.currentRound}</CardTitle>
          <CardDescription>{stateLabel}</CardDescription>
          <CardAction>
            <Badge variant={status.state === "open" ? "default" : "secondary"}>
              {status.state === "open" ? <Clock3Icon data-icon="inline-start" /> : <CalendarClockIcon data-icon="inline-start" />}
              {stateLabel}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {status.rounds.length ? (
            <div className="flex flex-col gap-6">
              {status.rounds.map((activeRound) => {
                const progress = activeRound.totalGames
                  ? Math.round(((activeRound.totalGames - activeRound.openGames) / activeRound.totalGames) * 100)
                  : 0;
                return (
                  <section key={activeRound.weekKey} className="flex flex-col gap-4 border-b pb-6 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="font-medium">{activeRound.label}</h2>
                      <Badge variant="outline">{t.games(activeRound.totalGames)}</Badge>
                    </div>
                    {activeRound.totalGames ? (
                      <Progress value={progress}>
                        <ProgressLabel>{t.roundProgress}</ProgressLabel>
                        <ProgressValue>{`${progress}%`}</ProgressValue>
                      </Progress>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{t.openGames(activeRound.openGames)}</Badge>
                      <Badge variant="outline">{t.lockedGames(activeRound.lockedGames)}</Badge>
                    </div>
                    {activeRound.nextLockAt ? (
                      <p className="text-sm text-muted-foreground">
                        {t.nextLock}: <DateTime value={new Date(activeRound.nextLockAt * 1000).toISOString()} locale={locale} />
                      </p>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : round ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{t.openGames(round.openGames)}</Badge>
                <Badge variant="outline">{t.lockedGames(round.lockedGames)}</Badge>
                {status.state === "awaiting-scoring" ? <Badge variant="outline">{t.scoring}</Badge> : null}
              </div>
              {status.state === "upcoming" && round.opensAt ? (
                <p className="text-sm text-muted-foreground">
                  {t.opens}: <DateTime value={new Date(round.opensAt * 1000).toISOString()} locale={locale} />
                </p>
              ) : null}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleDashedIcon />
                </EmptyMedia>
                <EmptyTitle>{t.idle}</EmptyTitle>
                <EmptyDescription>{t.idleDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <PredictionPickerEntry locale={locale} />

      {status.upcomingRounds.length || status.awaitingRounds.length ? (
        <section className="flex flex-col gap-4" aria-label={t.currentRound}>
          {status.upcomingRounds.map((upcomingRound) => (
            <div key={upcomingRound.weekKey} className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
              <div>
                <p className="font-medium">{upcomingRound.label}</p>
                <p className="text-sm text-muted-foreground">{t.upcoming}</p>
              </div>
              {upcomingRound.opensAt ? <Badge variant="outline"><DateTime value={new Date(upcomingRound.opensAt * 1000).toISOString()} locale={locale} /></Badge> : null}
            </div>
          ))}
          {status.awaitingRounds.map((awaitingRound) => (
            <section key={awaitingRound.weekKey} className="flex flex-col gap-4 border-b pb-4 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{awaitingRound.label}</p>
                  <p className="text-sm text-muted-foreground">{t.awaiting}</p>
                </div>
                <Badge variant="outline">{t.scoring}</Badge>
              </div>
              <PickDistributionPanel distribution={pickDistributions.get(awaitingRound.id)} locale={locale} />
            </section>
          ))}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <Card size="sm" className="h-full">
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-md border bg-muted">
              <UserRoundIcon />
            </div>
            <CardTitle>{t.profileTitle}</CardTitle>
            <CardDescription>{t.profileDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={localizedPath("/me?tab=predictions", locale)} />} nativeButton={false} variant="outline" size="sm">
              {t.openProfile}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          </CardContent>
        </Card>

        <Card size="sm" className="h-full">
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-md border bg-muted">
              <TrophyIcon />
            </div>
            <CardTitle>{t.leaderboardTitle}</CardTitle>
            <CardDescription>{t.leaderboardDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={leaderboardHref} />} nativeButton={false} variant="outline" size="sm">
              {t.openLeaderboard}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
