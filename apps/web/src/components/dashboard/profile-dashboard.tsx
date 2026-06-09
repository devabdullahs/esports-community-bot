"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDaysIcon,
  ExternalLinkIcon,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  copy,
  formatDateTime,
  formatNumber,
  localizedPath,
  type Locale,
} from "@/lib/i18n";

type MePayload = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
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
    weeksScored: number;
    weeklyWins: number;
    top3Sweeps: number;
    topTeams: string[];
    seasonPicks: string[];
    seasonScore: number | null;
    showcaseUsername: string;
    recentWeekly: Array<{
      weekKey: string;
      label: string;
      status: string;
      score: number | null;
      picks: string[];
      bonus: number;
    }>;
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
}: {
  guildId?: string;
  season: string;
  locale: Locale;
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
      router.replace(`/me?season=${encodeURIComponent(season)}`);
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

  return (
    <div className="flex flex-col gap-6">
      <Card>
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
            <Button onClick={() => sync.mutate()} disabled={sync.isPending || !stats}>
              <RefreshCcwIcon data-icon="inline-start" />
              {text.sync}
            </Button>
            <Button variant="outline" onClick={() => unlink.mutate()} disabled={unlink.isPending || !data.link}>
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
      </Card>

      {stats ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <StatCard
              label={copy[locale].common.rank}
              value={stats.rank ? `#${formatNumber(stats.rank, locale)}` : text.unranked}
              icon={TrophyIcon}
            />
            <StatCard label={text.points} value={formatNumber(stats.overallPoints, locale)} icon={SparklesIcon} />
            <StatCard label={text.weeksScored} value={formatNumber(stats.weeksScored, locale)} icon={CalendarDaysIcon} />
            <StatCard label={text.weeklyWins} value={formatNumber(stats.weeklyWins, locale)} icon={MedalIcon} />
          </section>

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
                      {text.synced} {formatDateTime(data.link.lastSyncedAt, locale)}
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
                    stats.recentWeekly.map((week) => (
                      <div key={week.weekKey} className="flex flex-col gap-2 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium">{week.label}</p>
                            <p className="truncate text-sm text-muted-foreground">
                              {week.picks.join(", ") || text.noPicks}
                            </p>
                          </div>
                          <Badge variant={week.score == null ? "outline" : "secondary"}>
                            {week.score == null ? week.status : formatNumber(week.score, locale)}
                          </Badge>
                        </div>
                        {week.bonus ? (
                          <>
                            <Separator />
                            <p className="text-sm text-muted-foreground">
                              {text.sweepBonus}: {formatNumber(week.bonus, locale)}
                            </p>
                          </>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">{text.noWeeklyPicks}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
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
        <div className="flex items-center justify-between gap-2">
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
