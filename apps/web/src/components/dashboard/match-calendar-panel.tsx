"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarPlusIcon, CheckIcon, CopyIcon, DownloadIcon, RefreshCcwIcon } from "lucide-react";
import { useState } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { copy, type Locale } from "@/lib/i18n";
import type { MatchCalendarPayload } from "@/lib/match-calendar";

const feedHref = "/api/me/calendar/ics";

async function calendarJson(): Promise<MatchCalendarPayload> {
  const response = await fetch("/api/me/calendar", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data as MatchCalendarPayload;
}

export function MatchCalendarPanel({ locale }: { locale: Locale }) {
  const [copied, setCopied] = useState(false);
  const query = useQuery({
    queryKey: ["me-match-calendar"],
    queryFn: calendarJson,
    staleTime: 30_000,
  });

  async function copyFeedUrl() {
    try {
      await navigator.clipboard.writeText(new URL(feedHref, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <MatchCalendarPanelContent
      locale={locale}
      payload={query.data}
      loading={query.isLoading}
      error={query.isError}
      copied={copied}
      onCopyFeed={copyFeedUrl}
      onRetry={() => void query.refetch()}
    />
  );
}

export function MatchCalendarPanelContent({
  locale,
  payload,
  loading = false,
  error = false,
  copied = false,
  onCopyFeed,
  onRetry,
}: {
  locale: Locale;
  payload?: MatchCalendarPayload;
  loading?: boolean;
  error?: boolean;
  copied?: boolean;
  onCopyFeed?: () => void;
  onRetry?: () => void;
}) {
  const text = copy[locale].profile;
  if (loading) {
    return (
      <section aria-busy="true" aria-label={text.loadingCalendar}>
        <Card>
          <CardHeader>
            <CardTitle>{text.matchCalendar}</CardTitle>
            <CardDescription>{text.matchCalendarDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error || !payload) {
    return (
      <section aria-labelledby="match-calendar-title">
        <Card>
          <CardHeader>
            <CardTitle id="match-calendar-title">{text.matchCalendar}</CardTitle>
            <CardDescription>{text.matchCalendarDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <RefreshCcwIcon />
              <AlertTitle>{text.calendarUnavailable}</AlertTitle>
              {onRetry ? (
                <AlertDescription>
                  <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                    <RefreshCcwIcon data-icon="inline-start" />
                    {text.retryCalendar}
                  </Button>
                </AlertDescription>
              ) : null}
            </Alert>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="match-calendar-title">
      <Card>
        <CardHeader>
          <CardTitle id="match-calendar-title">{text.matchCalendar}</CardTitle>
          <CardDescription>{text.matchCalendarDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {payload.matches.length ? (
            <div className="divide-y">
              {payload.matches.map((match) => (
                <div key={match.id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium"><bdi>{match.teamA || "TBD"} vs {match.teamB || "TBD"}</bdi></p>
                    <p className="truncate text-xs text-muted-foreground"><bdi>{[match.tournamentName, match.game].filter(Boolean).join(" - ")}</bdi></p>
                    <LocalDateTime
                      value={new Date(match.scheduledAt * 1000).toISOString()}
                      locale={locale}
                      fallback={text.startsAt}
                      className="text-xs text-muted-foreground"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start sm:self-auto"
                    nativeButton={false}
                    render={<a href={`${feedHref}?match=${match.id}`} download />}
                  >
                    <CalendarPlusIcon data-icon="inline-start" />
                    {text.addToCalendar}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{text.noCalendarMatches}</p>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<a href={feedHref} download />}>
            <DownloadIcon data-icon="inline-start" />
            {text.downloadCalendar}
          </Button>
          <Button type="button" variant="outline" onClick={onCopyFeed} aria-live="polite">
            {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
            {copied ? text.calendarUrlCopied : text.copyCalendarUrl}
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}
