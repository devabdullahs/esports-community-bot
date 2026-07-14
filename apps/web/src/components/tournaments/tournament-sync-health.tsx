"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleHelpIcon, TriangleAlertIcon } from "lucide-react";
import type { TournamentMatchesPayload } from "@/components/tournaments/tournament-match-list";
import { LocalDateTime } from "@/components/local-date-time";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONTACT_EMAIL } from "@/lib/community-links";
import { copy, type Locale } from "@/lib/i18n";

const REFETCH_INTERVAL_MS = 90_000;

function sourceLabel(source: TournamentMatchesPayload["tournament"]["syncHealth"]["source"]) {
  return { liquipedia: "Liquipedia", startgg: "start.gg", pandascore: "PandaScore" }[source];
}

function dateValue(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

export function TournamentSyncHealthStatus({
  tournamentId,
  locale,
  initialData,
}: {
  tournamentId: number;
  locale: Locale;
  initialData: TournamentMatchesPayload;
}) {
  const text = copy[locale].tournaments;
  const query = useQuery<TournamentMatchesPayload>({
    queryKey: ["tournament-matches", tournamentId],
    queryFn: async () => {
      const response = await fetch(`/api/tournaments/${tournamentId}/matches`);
      if (!response.ok) throw new Error("Failed to load tournament health");
      return response.json();
    },
    initialData,
    refetchInterval: REFETCH_INTERVAL_MS,
  });
  const health = (query.data ?? initialData).tournament.syncHealth;
  const timestamp = health.lastSuccessAt == null
    ? <span>{text.syncNoSuccess}</span>
    : <LocalDateTime value={dateValue(health.lastSuccessAt)} locale={locale} fallback={text.syncTimestampLoading} />;
  const state = {
    fresh: { label: text.syncFresh, detail: text.syncUpdated, variant: "default" as const },
    delayed: { label: text.syncDelayed, detail: text.syncLastSuccess, variant: "secondary" as const },
    unavailable: { label: text.syncUnavailable, detail: text.syncLastKnown, variant: "destructive" as const },
    final: { label: text.syncFinal, detail: text.syncFinalSnapshot, variant: "outline" as const },
  }[health.state];
  const issueHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Tournament #${tournamentId} - ${sourceLabel(health.source)}`)}`;
  const warning = health.state === "delayed"
    ? text.syncDelayedWarning
    : health.state === "unavailable"
      ? text.syncUnavailableWarning
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-sync-health={health.state} aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={state.variant}>{state.label}</Badge>
        <span className="text-sm text-muted-foreground">
          {state.detail}: {timestamp}
        </span>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
            <CircleHelpIcon className="size-3.5 text-muted-foreground" aria-label={text.syncHealthDetails} />
          </TooltipTrigger>
          <TooltipContent>{text.syncHealthDetails}</TooltipContent>
        </Tooltip>
        <Button
          render={<a href={issueHref} />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
        >
          {text.reportDataIssue}
        </Button>
      </div>
      {warning ? (
        <Alert variant={health.state === "unavailable" ? "destructive" : "default"}>
          <TriangleAlertIcon />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
