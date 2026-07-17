"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, RadioIcon, RefreshCwIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import type { LiveMatchCenter as LiveMatchCenterData, LiveMatchCenterItem } from "@/lib/live-match-center";
import { safeUrlOrUndefined } from "@/lib/safe-url";

const REFETCH_INTERVAL_MS = 75_000;

function teamLabel(value: string | null, fallback: string) {
  return value?.trim() || fallback;
}

function MatchTime({ value, locale, fallback }: { value: number | null; locale: Locale; fallback: string }) {
  if (value == null || !Number.isFinite(value)) return <span>{fallback}</span>;
  return <LocalDateTime value={new Date(value * 1000).toISOString()} locale={locale} fallback={fallback} />;
}

function MatchTeams({ item, locale }: { item: LiveMatchCenterItem; locale: Locale }) {
  const text = copy[locale].tournaments;
  const a = teamLabel(item.teamA, text.tbd);
  const b = teamLabel(item.teamB, text.tbd);
  const hasScore = item.scoreA != null && item.scoreB != null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3" dir={locale === "ar" ? "rtl" : "ltr"}>
      <bdi className="min-w-0 truncate text-start text-sm font-semibold">{a}</bdi>
      <span className="shrink-0 tabular-nums text-sm font-semibold">
        {hasScore ? (
          <>{item.scoreA} <span className="text-muted-foreground">-</span> {item.scoreB}</>
        ) : (
          <span className="text-muted-foreground">{text.vs}</span>
        )}
      </span>
      <bdi className="min-w-0 truncate text-end text-sm font-semibold">{b}</bdi>
    </div>
  );
}

function StreamLinks({ item, locale }: { item: LiveMatchCenterItem; locale: Locale }) {
  const text = copy[locale].tournaments;
  const officialUrl = safeUrlOrUndefined(item.stream?.url);
  const coStreams = item.coStreams
    .map((stream) => ({ ...stream, url: safeUrlOrUndefined(stream.url) }))
    .filter((stream): stream is typeof stream & { url: string } => Boolean(stream.url));
  if (!officialUrl && !coStreams.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2 text-xs text-muted-foreground">
      {officialUrl && item.stream ? (
        <a
          href={officialUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
        >
          <PlatformIcon platform={item.stream.platform} className="size-3.5" />
          {text.watchNow}
        </a>
      ) : null}
      {coStreams.length ? (
        <span className="inline-flex items-center gap-1.5">
          <RadioIcon className="size-3 text-primary" />
          {text.coStreaming}
        </span>
      ) : null}
      {coStreams.map((stream) => (
        <a
          key={`${stream.platform}:${stream.handle}`}
          href={stream.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-40 items-center gap-1 text-foreground/80 hover:text-foreground hover:underline"
        >
          <PlatformIcon platform={stream.platform} className="size-3.5 shrink-0" />
          <bdi className="truncate">{stream.label}</bdi>
        </a>
      ))}
    </div>
  );
}

function MatchCard({ item, locale, live }: { item: LiveMatchCenterItem; locale: Locale; live: boolean }) {
  const text = copy[locale].tournaments;
  const title = item.name?.trim() || `${teamLabel(item.teamA, text.tbd)} ${text.vs} ${teamLabel(item.teamB, text.tbd)}`;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {live ? <Badge variant="destructive">{text.liveNow}</Badge> : <Badge variant="secondary">{text.upcoming}</Badge>}
          {item.game ? <Badge variant="outline"><bdi>{item.game}</bdi></Badge> : null}
          <span className="text-xs text-muted-foreground">
            <MatchTime value={item.scheduledAt} locale={locale} fallback={text.timeTbd} />
          </span>
        </div>
        <Link
          href={localizedPath(item.tournamentHref, locale)}
          className="min-w-0 truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
        >
          <bdi>{item.tournamentName || title}</bdi>
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <MatchTeams item={item} locale={locale} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <bdi className="min-w-0 truncate text-muted-foreground">{title}</bdi>
          {item.detailsHref ? (
            <Link href={localizedPath(item.detailsHref, locale)} className="shrink-0 font-medium text-primary hover:underline">
              {text.matchDetails}
            </Link>
          ) : null}
        </div>
      </CardContent>
      <StreamLinks item={item} locale={locale} />
    </Card>
  );
}

function EmptyState({ live, locale }: { live: boolean; locale: Locale }) {
  const text = copy[locale].tournaments;
  const liveText = copy[locale].live;
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 border border-dashed px-5 text-center">
      {live ? <RadioIcon className="size-5 text-muted-foreground" /> : <CalendarClockIcon className="size-5 text-muted-foreground" />}
      <p className="text-sm font-medium">{live ? text.noLive : text.noUpcoming}</p>
      <p className="max-w-md text-sm text-muted-foreground">{live ? liveText.noLiveDescription : liveText.noUpcomingDescription}</p>
    </div>
  );
}

function RecentFinished({ items, locale }: { items: LiveMatchCenterItem[]; locale: Locale }) {
  const text = copy[locale].tournaments;
  const liveText = copy[locale].live;
  if (!items.length) return null;

  return (
    <section aria-labelledby="live-recent-results" className="border-y py-5">
      <div className="mb-3 flex items-center gap-2">
        <TrophyIcon className="size-4 text-muted-foreground" />
        <h2 id="live-recent-results" className="text-sm font-semibold">{liveText.recentContext}</h2>
      </div>
      <ol className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center justify-between gap-4 py-2 text-sm">
            <div className="min-w-0">
              <Link href={localizedPath(item.tournamentHref, locale)} className="block truncate font-medium hover:text-primary hover:underline">
                <bdi>{item.tournamentName || text.tbd}</bdi>
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                <bdi>{teamLabel(item.teamA, text.tbd)}</bdi> <span>{text.vs}</span> <bdi>{teamLabel(item.teamB, text.tbd)}</bdi>
              </p>
            </div>
            <span className="shrink-0 tabular-nums font-semibold">
              {item.scoreA ?? "-"} <span className="text-muted-foreground">-</span> {item.scoreB ?? "-"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function LiveMatchCenter({ initialData, locale }: { initialData: LiveMatchCenterData; locale: Locale }) {
  const liveText = copy[locale].live;
  const matchText = copy[locale].tournaments;
  const query = useQuery<LiveMatchCenterData>({
    queryKey: ["live-match-center"],
    queryFn: async () => {
      const response = await fetch("/api/live");
      if (!response.ok) throw new Error("Failed to load live matches");
      return response.json();
    },
    initialData,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const data = query.data ?? initialData;
  const defaultTab = data.running.length ? "live" : "upcoming";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="max-w-2xl space-y-2">
          <p className="text-sm font-medium text-primary">{liveText.eyebrow}</p>
          <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">{liveText.title}</h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">{liveText.description}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <RefreshCwIcon className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />
          <span>{matchText.liveNow}: {data.running.length}</span>
        </div>
      </header>

      <Tabs defaultValue={defaultTab} className="gap-5">
        <TabsList aria-label={liveText.tabsLabel}>
          <TabsTrigger value="live">
            <RadioIcon />
            {matchText.liveNow}
            <Badge variant="secondary">{data.running.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            <CalendarClockIcon />
            {matchText.upcoming}
            <Badge variant="secondary">{data.upcoming.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="live">
          {data.running.length ? (
            <section aria-label={matchText.liveNow} className="grid gap-3 lg:grid-cols-2">
              {data.running.map((item) => <MatchCard key={item.id} item={item} locale={locale} live />)}
            </section>
          ) : <EmptyState live locale={locale} />}
        </TabsContent>
        <TabsContent value="upcoming">
          {data.upcoming.length ? (
            <section aria-label={matchText.upcoming} className="grid gap-3 lg:grid-cols-2">
              {data.upcoming.map((item) => <MatchCard key={item.id} item={item} locale={locale} live={false} />)}
            </section>
          ) : <EmptyState live={false} locale={locale} />}
        </TabsContent>
      </Tabs>

      <RecentFinished items={data.recentFinished} locale={locale} />
    </main>
  );
}
