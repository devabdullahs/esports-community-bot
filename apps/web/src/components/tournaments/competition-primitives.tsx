"use client";

import { useState } from "react";
import { CalendarClockIcon, CircleStopIcon, ClockIcon, RadioIcon } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { copy, formatNumber, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
import type { MatchStatus } from "@/lib/match-lifecycle";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import type { TournamentDirectoryMatch } from "@/lib/tournament-directory";
import { GameIcon, SourceIcon, TournamentMark } from "@/components/tournaments/competition-icons";

type CompetitionState = MatchStatus | "live" | "upcoming" | "results" | "idle";

export function CompetitionStatusBadge({
  status,
  locale,
}: {
  status: CompetitionState;
  locale: Locale;
}) {
  const text = copy[locale].tournaments;
  if (status === "idle") return null;
  const config =
    status === "running" || status === "live"
      ? { label: text.liveNow, icon: RadioIcon, className: "border-primary/35 bg-primary/10 text-primary" }
      : status === "scheduled" || status === "upcoming"
        ? { label: text.upcoming, icon: CalendarClockIcon, className: "border-border bg-secondary text-secondary-foreground" }
        : status === "postponed"
          ? { label: text.postponed, icon: ClockIcon, className: "border-border bg-secondary text-secondary-foreground" }
          : status === "cancelled"
            ? { label: text.cancelled, icon: CircleStopIcon, className: "border-muted-foreground/30 bg-muted text-muted-foreground" }
            : { label: text.finished, icon: CircleStopIcon, className: "border-border bg-muted text-muted-foreground" };
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={config.className}>
      <Icon data-icon="inline-start" />
      {config.label}
    </Badge>
  );
}

export function TeamIdentity({
  name,
  logo,
  locale,
  winner = false,
  align = "start",
  compact = false,
}: {
  name: string | null;
  logo: string | null;
  locale: Locale;
  winner?: boolean;
  align?: "start" | "end";
  compact?: boolean;
}) {
  const fallback = copy[locale].tournaments.tbd;
  const safeName = name || fallback;
  return (
    <div
      className={[
        "flex min-w-0 items-center gap-2",
        align === "end" ? "flex-row-reverse text-end" : "",
        winner ? "font-semibold text-foreground" : "text-foreground",
      ].join(" ")}
    >
      <CompetitionTeamLogo name={safeName} logo={logo} compact={compact} />
      <span className="min-w-0 truncate text-sm" dir="auto">
        {safeName}
      </span>
    </div>
  );
}

function CompetitionTeamLogo({
  name,
  logo,
  compact,
}: {
  name: string;
  logo: string | null;
  compact: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const safe = safeUrlOrUndefined(logo);
  const size = compact ? "size-7" : "size-9";
  if (!safe || failed) {
    return (
      <span className={`grid ${size} shrink-0 place-items-center rounded-md bg-muted text-[0.62rem] font-semibold text-muted-foreground`}>
        {initials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoProxyUrl(safe)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${size} shrink-0 rounded-md bg-background object-contain p-1`}
    />
  );
}

export function SeriesScore({
  match,
  locale,
}: {
  match: TournamentDirectoryMatch;
  locale: Locale;
}) {
  if (match.score_a !== null && match.score_b !== null) {
    return (
      <span className="whitespace-nowrap text-center text-sm font-semibold tabular-nums">
        {formatNumber(match.score_a, locale)} - {formatNumber(match.score_b, locale)}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap text-center text-xs font-medium text-muted-foreground">
      {copy[locale].tournaments.vs}
    </span>
  );
}

export function TournamentIdentity({
  name,
  id,
  game,
  gameTitle,
  source,
  sourceLabel,
  locale,
}: {
  name: string | null;
  id: number;
  game: string;
  gameTitle: string;
  source: string;
  sourceLabel: string;
  locale: Locale;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <TournamentMark slug={game} />
      <div className="min-w-0">
        <h2 className="line-clamp-2 text-base font-semibold" dir="auto">
          {name || `#${formatNumber(id, locale)}`}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <GameIcon slug={game} />
            {gameTitle}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <SourceIcon source={source} />
            {sourceLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

export function FixtureRow({
  match,
  locale,
  status,
  label,
}: {
  match: TournamentDirectoryMatch;
  locale: Locale;
  status?: CompetitionState;
  label?: string;
}) {
  const winnerA = match.winner_side === "team1";
  const winnerB = match.winner_side === "team2";
  return (
    <div className="grid gap-3 border-t py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
        <TeamIdentity name={match.team_a} logo={match.logo_a} locale={locale} winner={winnerA} compact />
        <SeriesScore match={match} locale={locale} />
        <TeamIdentity name={match.team_b} logo={match.logo_b} locale={locale} winner={winnerB} compact align="end" />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-col sm:items-end sm:justify-center">
        {status ? <CompetitionStatusBadge status={status} locale={locale} /> : label ? <span>{label}</span> : null}
        {match.scheduled_at ? (
          <LocalDateTime
            value={match.scheduled_at}
            locale={locale}
            fallback={copy[locale].tournaments.timeTbd}
            className="whitespace-nowrap tabular-nums"
          />
        ) : null}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
