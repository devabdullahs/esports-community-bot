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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
}: {
  guildId?: string;
  season: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
    return <Skeleton className="h-96 w-full" />;
  }

  if (query.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Profile unavailable</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    );
  }

  const data = query.data;
  const stats = data.stats;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              <AvatarImage src={data.user.image || undefined} alt="" />
              <AvatarFallback>{(data.user.name || "E").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>{data.user.name || "EWC Predictor"}</CardTitle>
              <CardDescription>{data.discordUserId || "Discord account pending"}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {stats?.guildId ? (
              <Button
                render={<Link href={`/leaderboard/${stats.guildId}/${stats.season}`} />}
                nativeButton={false}
                variant="outline"
              >
                <ExternalLinkIcon data-icon="inline-start" />
                Leaderboard
              </Button>
            ) : null}
            <Button onClick={() => sync.mutate()} disabled={sync.isPending || !stats}>
              <RefreshCcwIcon data-icon="inline-start" />
              Sync profile
            </Button>
            <Button variant="outline" onClick={() => unlink.mutate()} disabled={unlink.isPending || !data.link}>
              <UnlinkIcon data-icon="inline-start" />
              Unlink
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!stats ? (
            <Alert>
              <AlertTitle>No active prediction profile</AlertTitle>
              <AlertDescription>Open this page from `/ewc_predict link` in Discord to select a server.</AlertDescription>
            </Alert>
          ) : null}
          {data.link?.lastSyncError ? (
            <Alert variant="destructive">
              <AlertTitle>Last sync failed</AlertTitle>
              <AlertDescription>{data.link.lastSyncError}</AlertDescription>
            </Alert>
          ) : null}
          {sync.error ? (
            <Alert variant="destructive">
              <AlertTitle>Sync failed</AlertTitle>
              <AlertDescription>{sync.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {unlink.error ? (
            <Alert variant="destructive">
              <AlertTitle>Unlink failed</AlertTitle>
              <AlertDescription>{unlink.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {stats ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <StatCard label="Rank" value={stats.rank ? `#${stats.rank}` : "Unranked"} icon={TrophyIcon} accent />
            <StatCard label="Points" value={stats.overallPoints.toLocaleString()} icon={SparklesIcon} />
            <StatCard label="Weeks scored" value={String(stats.weeksScored)} icon={CalendarDaysIcon} />
            <StatCard label="Weekly wins" value={String(stats.weeklyWins)} icon={MedalIcon} />
          </section>

          <Tabs defaultValue="showcase">
            <TabsList>
              <TabsTrigger value="showcase">Showcase</TabsTrigger>
              <TabsTrigger value="season">Season picks</TabsTrigger>
              <TabsTrigger value="weekly">Weekly history</TabsTrigger>
            </TabsList>
            <TabsContent value="showcase">
              <Card>
                <CardHeader>
                  <CardTitle>EWC Predictions</CardTitle>
                  <CardDescription>{stats.showcaseUsername}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{stats.top3Sweeps} top 3 sweep{stats.top3Sweeps === 1 ? "" : "s"}</Badge>
                  {data.link?.lastSyncedAt ? <Badge variant="outline">Synced {data.link.lastSyncedAt}</Badge> : null}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="season">
              <Card>
                <CardHeader>
                  <CardTitle>Season picks</CardTitle>
                  <CardDescription>
                    {stats.seasonScore == null ? "Not scored yet" : `${stats.seasonScore.toLocaleString()} points`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {stats.seasonPicks.length ? (
                    stats.seasonPicks.map((team, index) => (
                      <Badge key={`${team}-${index}`} variant="secondary">
                        {index + 1}. {team}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No season picks yet.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="weekly">
              <Card>
                <CardHeader>
                  <CardTitle>Recent weekly rounds</CardTitle>
                  <CardDescription>{stats.weeksScored} scored week{stats.weeksScored === 1 ? "" : "s"}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {stats.recentWeekly.length ? (
                    stats.recentWeekly.map((week) => (
                      <div key={week.weekKey} className="flex flex-col gap-2 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{week.label}</p>
                            <p className="text-sm text-muted-foreground">{week.picks.join(", ") || "No picks"}</p>
                          </div>
                          <Badge variant={week.score == null ? "outline" : "secondary"}>
                            {week.score == null ? week.status : week.score.toLocaleString()}
                          </Badge>
                        </div>
                        {week.bonus ? (
                          <>
                            <Separator />
                            <p className="text-sm text-muted-foreground">Top 3 sweep bonus: {week.bonus}</p>
                          </>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No weekly picks yet.</p>
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
  accent,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  accent?: boolean;
}) {
  return (
    <Card className="gap-0 transition-colors hover:border-primary/40">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {Icon ? <Icon className={cn("size-4 text-muted-foreground", accent && "text-primary")} /> : null}
        </div>
        <CardTitle className={cn("text-2xl tabular-nums", accent && "text-primary")}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
