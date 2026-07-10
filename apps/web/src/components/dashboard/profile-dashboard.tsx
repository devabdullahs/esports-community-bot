"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDaysIcon,
  Clock3Icon,
  ExternalLinkIcon,
  ListChecksIcon,
  MessageCircleIcon,
  type LucideIcon,
  MedalIcon,
  RefreshCcwIcon,
  SparklesIcon,
  TrophyIcon,
  UnlinkIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalDateTime } from "@/components/local-date-time";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { WebPredictionPicker } from "@/components/predictions/web-prediction-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  copy,
  formatNumber,
  localizedPath,
  type Locale,
} from "@/lib/i18n";
import {
  isExpandableScoreBreakdown,
  scoreBreakdownStatusKey,
  type PredictionBreakdown,
  type PredictionBreakdownRow,
} from "@/lib/prediction-breakdown-model";

type MePayload = {
  user: {
    id: string;
    name?: string | null;
    image?: string | null;
  };
  discordUserId: string | null;
  link: {
    guildId: string;
    season: string;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  } | null;
  stats: {
    guildId: string;
    season: string;
    rank: number | null;
    overallPoints: number;
    weeksPredicted: number;
    weeksScored: number;
    weeklyWins: number;
    top3Sweeps: number;
    topTeams: string[];
    seasonPicks: string[];
    seasonScore: number | null;
    seasonBreakdown: PredictionBreakdown | null;
    showcaseUsername: string;
    recentWeekly: Array<{
      weekKey: string;
      label: string;
      status: string;
      score: number | null;
      picks: string[];
      bonus: number;
      breakdown: PredictionBreakdown | null;
    }>;
  } | null;
  currentRound: {
    id: number;
    weekKey: string;
    label: string;
    status: string;
    closesAt: number | null;
    finalLockAt: number | null;
    openGames: number;
    lockedGames: number;
    totalGames: number;
    pickedGames: number;
    remainingGameKeys: string[];
    openUnpickedGames: number;
    openUnpickedGameKeys: string[];
    lockedUnpickedGames: number;
    lockedUnpickedGameKeys: string[];
    nextLockAt: number | null;
    isComplete: boolean;
    discordUrl: string;
  } | null;
  actionableRounds: Array<{
    id: number;
    weekKey: string;
    label: string;
    status: string;
    closesAt: number | null;
    nextLockAt: number | null;
    finalLockAt: number | null;
    openGames: number;
    lockedGames: number;
    totalGames: number;
    pickedGames: number;
    isComplete: boolean;
    remainingGameKeys: string[];
    openUnpickedGames: number;
    openUnpickedGameKeys: string[];
    lockedUnpickedGames: number;
    lockedUnpickedGameKeys: string[];
    discordUrl: string;
  }>;
  picker: {
    weekly: Array<{
      weekKey: string;
      label: string;
      games: Array<{
        key: string;
        game: string;
        event: string | null;
        lockAt: number | null;
        state: "open" | "locked";
        pick: string | null;
        choices?: string[];
      }>;
    }>;
    season: {
      topSize: number;
      status: string;
      openAt: number | null;
      closeAt: number | null;
      picks: string[];
      choices: string[];
    } | null;
  } | null;
};

async function jsonOrThrow(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

export function ProfileDashboard({
  guildId,
  season,
  locale,
  section = "all",
}: {
  guildId?: string;
  season: string;
  locale: Locale;
  section?: "all" | "overview" | "predictions";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const text = copy[locale].profile;
  const query = useQuery<MePayload>({
    queryKey: ["me-ewc", guildId || "", season],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (guildId) params.set("guildId", guildId);
      params.set("season", season);
      if (guildId) {
        return jsonOrThrow(
          await fetch("/api/me/ewc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guildId, season }),
          }),
        );
      }
      return jsonOrThrow(await fetch(`/api/me/ewc?${params.toString()}`));
    },
  });

  const sync = useMutation({
    mutationFn: async () =>
      jsonOrThrow(
        await fetch("/api/me/ewc/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guildId, season }),
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me-ewc"] }),
  });

  const unlink = useMutation({
    mutationFn: async () =>
      jsonOrThrow(
        await fetch("/api/me/ewc/unlink", {
          method: "POST",
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me-ewc"] });
      router.replace(localizedPath(`/me?season=${encodeURIComponent(season)}`, locale));
    },
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </CardHeader>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (query.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{text.unavailableTitle}</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    );
  }

  const data = query.data;
  const stats = data.stats;
  const currentRound = data.currentRound;
  const actionableRounds = data.actionableRounds || (currentRound ? [currentRound] : []);

  return (
    <div className="flex flex-col gap-6">
      {section !== "predictions" ? <Card>
        <CardHeader className="gap-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              <AvatarImage src={data.user.image || undefined} alt="" />
              <AvatarFallback>{(data.user.name || "E").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate">{data.user.name || "EWC Predictor"}</CardTitle>
              <CardDescription className="truncate" dir="ltr">
                {data.discordUserId || text.discordPending}
              </CardDescription>
            </div>
          </div>
          <CardAction className="col-span-full col-start-1 row-start-2 flex flex-wrap gap-2 justify-self-start sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
            {stats?.guildId ? (
              <Button
                render={<Link href={localizedPath(`/leaderboard/${stats.guildId}/${stats.season}`, locale)} />}
                nativeButton={false}
                variant="outline"
              >
                <ExternalLinkIcon data-icon="inline-start" />
                {text.leaderboard}
              </Button>
            ) : null}
            <Button onClick={() => sync.mutate()} disabled={sync.isPending || unlink.isPending || !stats}>
              <RefreshCcwIcon data-icon="inline-start" />
              {text.sync}
            </Button>
            <Button variant="outline" onClick={() => unlink.mutate()} disabled={unlink.isPending || sync.isPending || !data.link}>
              <UnlinkIcon data-icon="inline-start" />
              {text.unlink}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!stats ? (
            <Alert>
              <AlertTitle>{text.noProfileTitle}</AlertTitle>
              <AlertDescription>{text.noProfileDescription}</AlertDescription>
            </Alert>
          ) : null}
          {data.link?.lastSyncError ? (
            <Alert variant="destructive">
              <AlertTitle>{text.lastSyncFailed}</AlertTitle>
              <AlertDescription>{data.link.lastSyncError}</AlertDescription>
            </Alert>
          ) : null}
          {sync.error ? (
            <Alert variant="destructive">
              <AlertTitle>{text.syncFailed}</AlertTitle>
              <AlertDescription>{sync.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {unlink.error ? (
            <Alert variant="destructive">
              <AlertTitle>{text.unlinkFailed}</AlertTitle>
              <AlertDescription>{unlink.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card> : null}

      {stats ? (
        <>
          {section !== "predictions" ? <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <StatCard
              label={copy[locale].common.rank}
              value={stats.rank ? `#${formatNumber(stats.rank, locale)}` : text.unranked}
              icon={TrophyIcon}
            />
            <StatCard label={text.points} value={formatNumber(stats.overallPoints, locale)} icon={SparklesIcon} />
            <StatCard
              label={text.weeksPredicted}
              value={formatNumber(stats.weeksPredicted, locale)}
              icon={CalendarDaysIcon}
            />
            <StatCard label={text.weeklyWins} value={formatNumber(stats.weeklyWins, locale)} icon={MedalIcon} />
          </section> : null}

          {section !== "overview" ? <>{actionableRounds.length ? (
            <div className="flex flex-col gap-4">
              <WebPredictionPicker picker={data.picker} locale={locale} queryKey={["me-ewc", guildId || "", season]} />
              {actionableRounds.map((round) => (
                <Card key={round.weekKey}>
                  <CardHeader>
                    <CardTitle>{round.label}</CardTitle>
                    <CardDescription>{text.currentRoundDescription}</CardDescription>
                    <CardAction>
                      <Badge variant={round.status === "open" ? "default" : "secondary"}>
                        <Clock3Icon data-icon="inline-start" />
                        {text.roundStatus[round.status as keyof typeof text.roundStatus] || round.status}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <Progress
                      value={round.totalGames ? Math.min(100, Math.round((round.pickedGames / round.totalGames) * 100)) : 0}
                    >
                      <ProgressLabel>{text.pickProgress}</ProgressLabel>
                      <ProgressValue>
                        {() => `${formatNumber(round.pickedGames, locale)}/${formatNumber(round.totalGames, locale)}`}
                      </ProgressValue>
                    </Progress>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">
                        <ListChecksIcon data-icon="inline-start" />
                        {round.isComplete ? text.picksComplete : text.remainingPicks(round.openUnpickedGames)}
                      </Badge>
                      {round.lockedUnpickedGames ? <Badge variant="outline">{text.missedPicks(round.lockedUnpickedGames)}</Badge> : null}
                      {round.nextLockAt ? (
                        <Badge variant="outline">
                          {text.nextLock}{" "}
                          <LocalDateTime value={new Date(round.nextLockAt * 1000).toISOString()} locale={locale} />
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button render={<a href={round.discordUrl} target="_blank" rel="noreferrer" />} nativeButton={false} variant="outline">
                        <MessageCircleIcon data-icon="inline-start" />
                        {text.openMyPicks}
                      </Button>
                      <Button
                        render={<Link href={localizedPath(`/leaderboard/${stats.guildId}/${stats.season}`, locale)} />}
                        nativeButton={false}
                        variant="outline"
                      >
                        <TrophyIcon data-icon="inline-start" />
                        {text.leaderboard}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Alert>
              <CalendarDaysIcon />
              <AlertTitle>{text.noCurrentRound}</AlertTitle>
              <AlertDescription>{text.noCurrentRoundDescription}</AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="showcase">
            <TabsList>
              <TabsTrigger value="showcase">{text.showcase}</TabsTrigger>
              <TabsTrigger value="season">{text.seasonPicks}</TabsTrigger>
              <TabsTrigger value="weekly">{text.weeklyHistory}</TabsTrigger>
            </TabsList>
            <TabsContent value="showcase">
              <Card>
                <CardHeader>
                  <CardTitle>{copy[locale].common.brand}</CardTitle>
                  <CardDescription dir="ltr">{stats.showcaseUsername}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{text.top3Sweep(stats.top3Sweeps)}</Badge>
                  {data.link?.lastSyncedAt ? (
                    <Badge variant="outline" title={data.link.lastSyncedAt}>
                      {text.synced} <LocalDateTime value={data.link.lastSyncedAt} locale={locale} />
                    </Badge>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="season">
              <Card>
                <CardHeader>
                  <CardTitle>{text.seasonPicks}</CardTitle>
                  <CardDescription>
                    {stats.seasonScore == null
                      ? text.notScored
                      : `${formatNumber(stats.seasonScore, locale)} ${text.points}`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {stats.seasonPicks.length ? (
                    stats.seasonPicks.map((team, index) => (
                      <Badge key={`${team}-${index}`} variant="secondary">
                        {formatNumber(index + 1, locale)}. {team}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">{text.noSeasonPicks}</p>
                  )}
                </CardContent>
                {stats.seasonBreakdown ? (
                  <CardContent>
                    <ScoreBreakdown breakdown={stats.seasonBreakdown} locale={locale} />
                  </CardContent>
                ) : null}
              </Card>
            </TabsContent>
            <TabsContent value="weekly">
              <Card>
                <CardHeader>
                  <CardTitle>{text.recentWeekly}</CardTitle>
                  <CardDescription>{text.scoredWeeks(stats.weeksScored)}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {stats.recentWeekly.length ? (
                    <Accordion defaultValue={[]}>
                      {stats.recentWeekly.map((week) => {
                        const expandable = isExpandableScoreBreakdown(week.breakdown);
                        const summary = (
                          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium">{week.label}</p>
                              <p className="truncate text-sm text-muted-foreground">{week.picks.join(", ") || text.noPicks}</p>
                            </div>
                            <Badge variant={week.score == null ? "outline" : "secondary"}>
                              {week.score == null ? week.status : formatNumber(week.score, locale)}
                            </Badge>
                          </div>
                        );
                        return (
                          <AccordionItem key={week.weekKey} value={week.weekKey} disabled={!expandable}>
                            <AccordionTrigger>{summary}</AccordionTrigger>
                            {expandable && week.breakdown ? (
                              <AccordionContent>
                                <ScoreBreakdown breakdown={week.breakdown} locale={locale} />
                              </AccordionContent>
                            ) : week.bonus ? (
                              <p className="pb-2 text-sm text-muted-foreground">
                                {text.sweepBonus}: {formatNumber(week.bonus, locale)}
                              </p>
                            ) : null}
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  ) : (
                    <p className="text-sm text-muted-foreground">{text.noWeeklyPicks}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs></> : null}
        </>
      ) : section === "predictions" ? (
        <Alert>
          <AlertTitle>{text.noProfileTitle}</AlertTitle>
          <AlertDescription>{text.noProfileDescription}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ScoreBreakdown({ breakdown, locale }: { breakdown: PredictionBreakdown; locale: Locale }) {
  const text = copy[locale].profile;
  if (!breakdown.available) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{text.scoreDetailsUnavailable}</AlertTitle>
        <AlertDescription>{text.scoreIntegrityWarning}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {breakdown.integrity === "mismatch" ? (
        <Alert variant="destructive">
          <AlertTitle>{text.scoreIntegrityWarning}</AlertTitle>
          <AlertDescription>{text.scoreDetailsUnavailable}</AlertDescription>
        </Alert>
      ) : null}
      {breakdown.rows.map((row, index) => (
        <div key={`${row.pick || row.game || "row"}-${index}`} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{breakdownRowTitle(row, index, breakdown.kind, locale)}</p>
            <Badge variant="secondary">{text.scoreStatus[scoreBreakdownStatusKey(row.status)]}</Badge>
          </div>
          <p className="break-words text-sm text-muted-foreground">{breakdownRowDetail(row, breakdown.kind, locale)}</p>
          <Badge variant="outline">{text.scorePoints}: {formatNumber(row.points, locale)}</Badge>
          {index < breakdown.rows.length - 1 ? <Separator /> : null}
        </div>
      ))}
      <Separator />
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{text.scoreTotal}: {formatNumber(breakdown.total, locale)}</Badge>
        {breakdown.bonus ? <Badge variant="outline">{text.scoreBonus}: {formatNumber(breakdown.bonus, locale)}</Badge> : null}
      </div>
    </div>
  );
}

function breakdownRowTitle(row: PredictionBreakdownRow, index: number, kind: PredictionBreakdown["kind"], locale: Locale): string {
  const text = copy[locale].profile;
  if (kind === "weekly-per-game") return row.game || `${text.scoreDetails} ${formatNumber(index + 1, locale)}`;
  if (kind === "season") return `${text.scorePredictedRank} #${formatNumber(row.predictedRank || index + 1, locale)}`;
  return `${text.scorePick} ${formatNumber(index + 1, locale)}`;
}

function breakdownRowDetail(row: PredictionBreakdownRow, kind: PredictionBreakdown["kind"], locale: Locale): string {
  const text = copy[locale].profile;
  if (kind === "weekly-per-game") {
    return [
      `${text.scorePick}: ${row.pick || "—"}`,
      `${text.scoreMatched}: ${row.matchedClub || "—"}`,
      row.placement ? `${text.scorePlacement}: ${row.placement}` : null,
      row.winner ? `${text.scoreWinner}: ${row.winner}` : null,
    ].filter(Boolean).join(" · ");
  }
  if (kind === "season") {
    return [
      `${text.scorePick}: ${row.pick || "—"}`,
      `${text.scoreMatched}: ${row.matchedTeam || "—"}`,
      `${text.scoreActualRank}: ${row.actualRank == null ? "—" : formatNumber(row.actualRank, locale)}`,
      `${text.scoreHitPoints}: ${formatNumber(row.hitPoints || 0, locale)}`,
      `${text.scoreExactBonus}: ${formatNumber(row.exactBonus || 0, locale)}`,
    ].join(" · ");
  }
  return [
    `${text.scorePick}: ${row.pick || "—"}`,
    `${text.scoreMatched}: ${row.matchedTeam || "—"}`,
    `${text.scorePredictedRank}: ${row.weeklyRank == null ? "—" : formatNumber(row.weeklyRank, locale)}`,
  ].join(" · ");
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {Icon ? <Icon className="text-muted-foreground" /> : null}
        </div>
        <CardTitle className="text-3xl font-semibold leading-none tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
