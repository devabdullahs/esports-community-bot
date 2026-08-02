import Link from "next/link";
import { ExternalLinkIcon, RadioIcon, TvIcon, UsersIcon } from "lucide-react";
import { MatchReminderButton } from "@/components/tournaments/match-reminder-button";
import { GameIcon, SourceIcon } from "@/components/tournaments/competition-icons";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MatchPageModel } from "@/lib/match-details";
import { displayImageUrl } from "@/lib/logo-url";
import { copy, formatNumber, formatUnixSeconds, localizedPath, type Locale } from "@/lib/i18n";
import {
  matchOutcomeLabel,
  matchStatusLabel,
  shouldShowOutcomeLabel,
} from "@/lib/match-lifecycle";
import { sourceLabel } from "@/lib/tournament-directory";

const PLATFORM_LABELS: Record<string, string> = {
  twitch: "Twitch",
  kick: "Kick",
  youtube: "YouTube",
  soop: "SOOP",
};

function platformLabel(platform: string) {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

function TeamLogo({ name, url }: { name: string; url: string | null }) {
  if (!url) {
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={displayImageUrl(url)} alt="" className="size-16 shrink-0 rounded-xl object-contain sm:size-20" />
  );
}

export function MatchHeader({
  model,
  locale,
  gameTitle,
  reminderState,
  callbackPath,
}: {
  model: MatchPageModel;
  locale: Locale;
  gameTitle: string;
  reminderState: { signedIn: boolean; reminderMatchIds: number[] };
  callbackPath: string;
}) {
  const text = copy[locale].tournaments;
  const teamA = model.teamA || text.tbd;
  const teamB = model.teamB || text.tbd;
  const score = model.scoreA != null && model.scoreB != null
    ? `${formatNumber(model.scoreA, locale)} - ${formatNumber(model.scoreB, locale)}`
    : text.vs;
  const providerLabel = sourceLabel(model.tournament.source || model.source);
  const showDetailedOutcome = model.status === "finished" && shouldShowOutcomeLabel({
    status: model.status,
    team_a: model.teamA,
    team_b: model.teamB,
    score_a: model.scoreA,
    score_b: model.scoreB,
    winner_side: model.winnerSide,
    result_reason: model.resultReason,
  });
  const outcome = matchOutcomeLabel({
    status: model.status,
    team_a: model.teamA,
    team_b: model.teamB,
    score_a: model.scoreA,
    score_b: model.scoreB,
    winner_side: model.winnerSide,
    result_reason: model.resultReason,
  }, locale);
  return (
    <header className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 sm:p-8">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {model.tournament.name ? (
            <Link
              href={localizedPath(`/tournaments/${model.tournament.id}`, locale)}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              <bdi>{model.tournament.name}</bdi>
            </Link>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <GameIcon slug={model.tournament.game ?? ""} />
            <bdi>{gameTitle}</bdi>
          </span>
          {model.tournament.url ? (
            <a
              href={model.tournament.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              <SourceIcon source={model.tournament.source} />
              {providerLabel}
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <SourceIcon source={model.tournament.source} />
              {providerLabel}
            </span>
          )}
          <Badge
            variant={model.status === "running" ? "destructive" : model.status === "postponed" ? "secondary" : "outline"}
          >
            {model.status === "running" ? <RadioIcon data-icon="inline-start" /> : null}
            {matchStatusLabel(model.status, locale)}
          </Badge>
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
          <div className="flex min-w-0 flex-col items-center gap-2" dir="ltr">
            <TeamLogo name={teamA} url={model.logoA} />
            <span className="max-w-full truncate text-sm font-semibold sm:text-base" title={teamA}>{teamA}</span>
          </div>
          <span className="text-3xl font-semibold tabular-nums sm:text-5xl" dir="ltr">
            {score}
          </span>
          <div className="flex min-w-0 flex-col items-center gap-2" dir="ltr">
            <TeamLogo name={teamB} url={model.logoB} />
            <span className="max-w-full truncate text-sm font-semibold sm:text-base" title={teamB}>{teamB}</span>
          </div>
        </div>
        {showDetailedOutcome ? (
          <p className="text-sm font-medium text-muted-foreground" dir="auto">{outcome}</p>
        ) : null}
        {model.scheduledAt ? (
          <time className="text-sm text-muted-foreground" dir="ltr">
            {formatUnixSeconds(model.scheduledAt, locale)}
          </time>
        ) : null}
        {(model.stream.url || model.status === "scheduled" || model.coStreams.some((stream) => stream.url)) ? (
          <div className="flex w-full flex-wrap items-center justify-center gap-2 border-t pt-4">
            {model.stream.url ? (
              <Button
                render={<a href={model.stream.url} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
                size="sm"
              >
                <TvIcon aria-hidden="true" />
                {text.watchNow}
                <ExternalLinkIcon aria-hidden="true" />
              </Button>
            ) : null}
            {model.status === "scheduled" ? (
              <MatchReminderButton
                matchId={model.id}
                signedIn={reminderState.signedIn}
                initialReminded={reminderState.reminderMatchIds.includes(model.id)}
                locale={locale}
                callbackPath={callbackPath}
                showLabel
              />
            ) : null}
            {model.coStreams.flatMap((stream) => stream.url ? [(
              <Button
                key={`${stream.platform}:${stream.handle}`}
                render={<a href={stream.url} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
                variant="outline"
                size="sm"
              >
                <UsersIcon aria-hidden="true" />
                <PlatformIcon platform={stream.platform} className="size-3.5" />
                <bdi>{stream.label}</bdi>
                <span className="text-muted-foreground">· {platformLabel(stream.platform)}</span>
                <ExternalLinkIcon aria-hidden="true" />
              </Button>
            )] : [])}
          </div>
        ) : null}
      </div>
    </header>
  );
}
