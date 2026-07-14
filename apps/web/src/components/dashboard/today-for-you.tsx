"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BellIcon,
  CalendarClockIcon,
  type LucideIcon,
  RadioIcon,
  RefreshCcwIcon,
  TargetIcon,
  TvIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import type { TodayForYouPayload } from "@/lib/today-for-you";

async function todayJson(): Promise<TodayForYouPayload> {
  const response = await fetch("/api/me/today", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data as TodayForYouPayload;
}

export function TodayForYou({ locale }: { locale: Locale }) {
  const query = useQuery({
    queryKey: ["me-today"],
    queryFn: todayJson,
    staleTime: 30_000,
  });

  return (
    <TodayForYouContent
      locale={locale}
      payload={query.data}
      loading={query.isLoading}
      error={query.isError}
      onRetry={() => void query.refetch()}
    />
  );
}

export function TodayForYouContent({
  locale,
  payload,
  loading = false,
  error = false,
  onRetry,
}: {
  locale: Locale;
  payload?: TodayForYouPayload;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const text = copy[locale].profile;
  const href = (value: string) => localizedPath(value, locale);
  if (loading) {
    return (
      <section aria-busy="true" aria-label={text.loadingToday} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{text.todayForYou}</h2>
          <p className="text-sm text-muted-foreground">{text.todayForYouDescription}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1].map((index) => <Skeleton key={index} className="h-36 w-full" />)}
        </div>
      </section>
    );
  }
  if (error || !payload) return <Unavailable locale={locale} onRetry={onRetry} />;

  const noFollows = payload.counts.follows === 0;
  const hasActivity = Boolean(
    payload.liveMatches.length
    || payload.upcomingMatches.length
    || payload.unreadNotifications.length
    || payload.actionableRounds.length
    || payload.coStreams.items.length,
  );

  return (
    <section aria-labelledby="today-for-you-title" className="flex min-w-0 flex-col gap-4 text-start">
      <div className="flex flex-col gap-1">
        <h2 id="today-for-you-title" className="text-xl font-semibold">{text.todayForYou}</h2>
        <p className="text-sm text-muted-foreground">{text.todayForYouDescription}</p>
      </div>

      {noFollows ? (
        <Alert>
          <TargetIcon />
          <AlertTitle>{text.noFollowsTodayTitle}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{text.noFollowsTodayDescription}</span>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(payload.hrefs.games)} />}>
              {text.browseGames}
            </Button>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(payload.hrefs.tournaments)} />}>
              {text.browseTournaments}
            </Button>
            {payload.actionableRounds.length ? (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(payload.hrefs.predictions)} />}>
                {text.picks}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!noFollows && !hasActivity && payload.coStreams.available ? (
        <Alert>
          <TargetIcon />
          <AlertTitle>{text.caughtUpTitle}</AlertTitle>
          <AlertDescription>{text.caughtUpDescription}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        {payload.liveMatches.length ? (
          <ActivityCard icon={RadioIcon} title={text.live} href={href(payload.hrefs.following)} linkLabel={text.viewAll}>
            {payload.liveMatches.map((match) => (
              <Link key={match.id} href={href(match.href)} className="flex min-w-0 items-center justify-between gap-3 py-1.5 hover:text-primary">
                <span className="min-w-0 truncate font-medium"><bdi>{match.teamA} vs {match.teamB}</bdi></span>
                <Badge variant="destructive" className="shrink-0">{text.live}</Badge>
              </Link>
            ))}
          </ActivityCard>
        ) : null}
        {payload.upcomingMatches.length ? (
          <ActivityCard icon={CalendarClockIcon} title={text.next} href={href(payload.hrefs.following)} linkLabel={text.viewAll}>
            {payload.upcomingMatches.map((match) => (
              <Link key={match.id} href={href(match.href)} className="flex min-w-0 items-center justify-between gap-3 py-1.5 hover:text-primary">
                <span className="min-w-0 truncate font-medium"><bdi>{match.teamA} vs {match.teamB}</bdi></span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {match.scheduledAt ? (
                    <LocalDateTime value={new Date(match.scheduledAt * 1000).toISOString()} locale={locale} fallback={text.startsAt} />
                  ) : text.startsAt}
                </span>
              </Link>
            ))}
          </ActivityCard>
        ) : null}
        {payload.unreadNotifications.length ? (
          <ActivityCard icon={BellIcon} title={text.unread} href={href(payload.hrefs.notifications)} linkLabel={text.viewAll}>
            {payload.unreadNotifications.map((notification, index) => {
              const content = (
                <>
                  <span className="min-w-0 truncate font-medium"><bdi>{notification.title}</bdi></span>
                  <Badge variant="secondary" className="shrink-0">{notification.type === "match_result" ? text.unread : text.live}</Badge>
                </>
              );
              return notification.href ? (
                <Link key={`${notification.title}-${index}`} href={href(notification.href)} className="flex min-w-0 items-center justify-between gap-3 py-1.5 hover:text-primary">
                  {content}
                </Link>
              ) : (
                <div key={`${notification.title}-${index}`} className="flex min-w-0 items-center justify-between gap-3 py-1.5">{content}</div>
              );
            })}
          </ActivityCard>
        ) : null}
        {payload.actionableRounds.length ? (
          <ActivityCard icon={TargetIcon} title={text.picks} href={href(payload.hrefs.predictions)} linkLabel={text.viewAll}>
            {payload.actionableRounds.map((round) => (
              <Link key={round.label} href={href(payload.hrefs.predictions)} className="flex min-w-0 items-center justify-between gap-3 py-1.5 hover:text-primary">
                <span className="min-w-0 truncate font-medium"><bdi>{round.label}</bdi></span>
                <Badge variant="secondary" className="shrink-0">{text.openPicks(round.openGames, round.totalGames)}</Badge>
              </Link>
            ))}
          </ActivityCard>
        ) : null}
        {payload.coStreams.items.length ? (
          <ActivityCard icon={TvIcon} title={text.coStreams} href={href(payload.hrefs.coStreams)} linkLabel={text.viewAll}>
            {payload.coStreams.items.map((stream, index) => (
              <Link key={`${stream.label}-${index}`} href={href(payload.hrefs.coStreams)} className="flex min-w-0 items-center justify-between gap-3 py-1.5 hover:text-primary">
                <span className="min-w-0 truncate font-medium"><bdi>{stream.label}</bdi></span>
                <Badge variant="secondary" className="shrink-0">{text.watchingNow}</Badge>
              </Link>
            ))}
          </ActivityCard>
        ) : null}
      </div>

      {!payload.coStreams.available ? <Unavailable locale={locale} onRetry={onRetry} /> : null}
    </section>
  );
}

function ActivityCard({
  icon: Icon,
  title,
  href,
  linkLabel,
  children,
}: {
  icon: LucideIcon;
  title: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon data-icon="inline-start" />{title}</CardTitle>
        <CardAction><Link href={href} className="text-sm text-primary hover:underline">{linkLabel}</Link></CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col divide-y">{children}</CardContent>
    </Card>
  );
}

function Unavailable({ locale, onRetry }: { locale: Locale; onRetry?: () => void }) {
  const text = copy[locale].profile;
  return (
    <Alert variant="destructive">
      <RefreshCcwIcon />
      <AlertTitle>{text.todayUnavailable}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{text.todayForYouDescription}</span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCcwIcon data-icon="inline-start" />
            {text.retryToday}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
