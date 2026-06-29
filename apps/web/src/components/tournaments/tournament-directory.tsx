"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ClockIcon,
  CrosshairIcon,
  Gamepad2Icon,
  ListFilterIcon,
  RadioIcon,
  SearchIcon,
  SwordsIcon,
  TrophyIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { copy, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import {
  filterTournamentDirectory,
  tournamentDirectoryStats,
  tournamentPrimaryStatus,
  type TournamentDirectoryItem,
  type TournamentStatusFilter,
} from "@/lib/tournament-directory";

type FilterOption = { value: string; label: string; count: number };

export function TournamentDirectory({
  locale,
  heading,
  tournaments,
  archiveHref = null,
}: {
  locale: Locale;
  heading: string;
  tournaments: TournamentDirectoryItem[];
  archiveHref?: string | null;
}) {
  const text = copy[locale].tournaments;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TournamentStatusFilter>("all");
  const [game, setGame] = useState("all");
  const [source, setSource] = useState("all");

  const stats = useMemo(() => tournamentDirectoryStats(tournaments), [tournaments]);
  const gameOptions = useMemo<FilterOption[]>(() => {
    const byGame = new Map<string, FilterOption>();
    for (const tournament of tournaments) {
      const value = tournament.game ?? "other";
      const existing = byGame.get(value);
      if (existing) {
        existing.count += 1;
      } else {
        byGame.set(value, { value, label: tournament.gameTitle, count: 1 });
      }
    }
    return [...byGame.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [tournaments]);
  const sourceOptions = useMemo<FilterOption[]>(() => {
    const bySource = new Map<string, FilterOption>();
    for (const tournament of tournaments) {
      const existing = bySource.get(tournament.source);
      if (existing) {
        existing.count += 1;
      } else {
        bySource.set(tournament.source, {
          value: tournament.source,
          label: tournament.sourceLabel,
          count: 1,
        });
      }
    }
    return [...bySource.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [tournaments]);

  const filtered = useMemo(
    () => filterTournamentDirectory(tournaments, { query, status, game, source }),
    [game, query, source, status, tournaments],
  );
  const hasFilters = query.trim() || status !== "all" || game !== "all" || source !== "all";

  const statusOptions: Array<{ value: TournamentStatusFilter; label: string; count: number }> = [
    { value: "all", label: text.allStatuses, count: tournaments.length },
    { value: "live", label: text.live, count: stats.live },
    { value: "upcoming", label: text.upcoming, count: stats.upcoming },
    { value: "results", label: text.results, count: stats.results },
  ];

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setGame("all");
    setSource("all");
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card/40 p-5 shadow-sm sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-3xl flex-col gap-3">
            <Badge variant="outline" className="w-fit border-primary/35 bg-primary/10 text-primary">
              <TrophyIcon data-icon="inline-start" />
              {text.eyebrow}
            </Badge>
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{heading}</h1>
              <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                {text.description}
              </p>
            </div>
            {archiveHref ? (
              <Link
                href={archiveHref}
                className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {text.archiveLink}
                <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
              </Link>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[31rem]">
            <StatPill icon={TrophyIcon} label={text.trackedTournaments} value={stats.tournaments} locale={locale} />
            <StatPill icon={Gamepad2Icon} label={text.trackedGames} value={stats.games} locale={locale} />
            <StatPill icon={RadioIcon} label={text.liveTournaments} value={stats.live} locale={locale} tone="live" />
            <StatPill icon={CalendarDaysIcon} label={text.upcomingTournaments} value={stats.upcoming} locale={locale} />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border bg-card/35 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <ListFilterIcon className="size-4 text-primary" />
            {text.filters}
          </div>
          <div className="text-xs text-muted-foreground">
            {text.showing} {formatNumber(filtered.length, locale)} /{" "}
            {formatNumber(tournaments.length, locale)}
          </div>
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text.searchPlaceholder}
            className="h-10 ps-8"
          />
        </div>

        <FilterRow>
          {statusOptions.map((option) => (
            <FilterButton
              key={option.value}
              active={status === option.value}
              label={option.label}
              count={option.count}
              locale={locale}
              onClick={() => setStatus(option.value)}
            />
          ))}
        </FilterRow>

        <FilterRow>
          <FilterButton
            active={game === "all"}
            label={text.allGames}
            count={stats.games}
            locale={locale}
            onClick={() => setGame("all")}
          />
          {gameOptions.map((option) => (
            <FilterButton
              key={option.value}
              active={game === option.value}
              label={option.label}
              count={option.count}
              locale={locale}
              onClick={() => setGame(option.value)}
              icon={<GameIcon slug={option.value} />}
            />
          ))}
        </FilterRow>

        <FilterRow>
          <FilterButton
            active={source === "all"}
            label={text.allSources}
            count={sourceOptions.length}
            locale={locale}
            onClick={() => setSource("all")}
          />
          {sourceOptions.map((option) => (
            <FilterButton
              key={option.value}
              active={source === option.value}
              label={option.label}
              count={option.count}
              locale={locale}
              onClick={() => setSource(option.value)}
              icon={<SourceIcon source={option.value} />}
            />
          ))}
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <XIcon data-icon="inline-start" />
              {text.clearFilters}
            </Button>
          ) : null}
        </FilterRow>
      </section>

      {filtered.length ? (
        <section className="grid gap-4 lg:grid-cols-2">
          {filtered.map((tournament) => (
            <TournamentCard key={tournament.id} locale={locale} tournament={tournament} />
          ))}
        </section>
      ) : (
        <Card className="items-center justify-center py-14 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl border bg-muted/40 text-muted-foreground">
              <SearchIcon className="size-5" />
            </div>
            <div className="text-base font-medium">{hasFilters ? text.noFiltered : text.empty}</div>
            {hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {text.clearFilters}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TournamentCard({
  locale,
  tournament,
}: {
  locale: Locale;
  tournament: TournamentDirectoryItem;
}) {
  const text = copy[locale].tournaments;
  const primaryStatus = tournamentPrimaryStatus(tournament);
  const match = tournament.featuredMatch;
  const label =
    primaryStatus === "live"
      ? text.liveNow
      : primaryStatus === "upcoming"
        ? text.nextMatch
        : primaryStatus === "results"
          ? text.latestResult
          : text.featuredMatch;

  return (
    <Link
      href={localizedPath(`/tournaments/${tournament.id}`, locale)}
      className="group block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        size="sm"
        className="h-full border-border/70 bg-card/70 transition-colors group-hover:border-primary/40 group-hover:bg-card"
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <TournamentMark slug={tournament.game ?? "other"} source={tournament.source} />
              <div className="min-w-0">
                <CardTitle className="line-clamp-2 text-base" dir="auto">
                  {tournament.name || `#${formatNumber(tournament.id, locale)}`}
                </CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="h-5 rounded-md">
                    <GameIcon slug={tournament.game ?? "other"} />
                    {tournament.gameTitle}
                  </Badge>
                  <Badge variant="outline" className="h-5 rounded-md text-muted-foreground">
                    <SourceIcon source={tournament.source} />
                    {tournament.sourceLabel}
                  </Badge>
                </div>
              </div>
            </div>
            <ArrowCue />
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            <Metric label={text.live} value={tournament.matchCounts.running} locale={locale} live />
            <Metric label={text.upcoming} value={tournament.matchCounts.scheduled} locale={locale} />
            <Metric label={text.results} value={tournament.matchCounts.finished} locale={locale} />
          </div>

          {match ? (
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  {primaryStatus === "live" ? (
                    <RadioIcon className="size-3.5 text-destructive" />
                  ) : (
                    <ClockIcon className="size-3.5 text-primary" />
                  )}
                  {label}
                </span>
                {match.scheduled_at ? (
                  <LocalDateTime
                    value={match.scheduled_at}
                    locale={locale}
                    fallback={text.timeTbd}
                    className="tabular-nums"
                  />
                ) : null}
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <TeamPreview name={match.team_a} logo={match.logo_a} />
                <MatchCenter match={match} locale={locale} />
                <TeamPreview name={match.team_b} logo={match.logo_b} align="end" />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/10 p-4 text-sm text-muted-foreground">
              {text.noMatches}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function FilterRow({ children }: { children: ReactNode }) {
  return <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{children}</div>;
}

function FilterButton({
  active,
  label,
  count,
  locale,
  onClick,
  icon,
}: {
  active: boolean;
  label: string;
  count: number;
  locale: Locale;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className="shrink-0"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <span className="rounded-md bg-background/35 px-1.5 py-0.5 text-[0.7rem] tabular-nums">
        {formatNumber(count, locale)}
      </span>
    </Button>
  );
}

function StatPill({
  icon: Icon,
  label,
  value,
  locale,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  locale: Locale;
  tone?: "live";
}) {
  return (
    <div className="rounded-xl border bg-background/40 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={tone === "live" ? "size-3.5 text-destructive" : "size-3.5 text-primary"} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {formatNumber(value, locale)}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  locale,
  live,
}: {
  label: string;
  value: number;
  locale: Locale;
  live?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/35 px-2 py-2 text-center">
      <div className={live && value > 0 ? "text-sm font-semibold text-destructive" : "text-sm font-semibold"}>
        {formatNumber(value, locale)}
      </div>
      <div className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">{label}</div>
    </div>
  );
}

function MatchCenter({
  match,
  locale,
}: {
  match: TournamentDirectoryItem["featuredMatch"];
  locale: Locale;
}) {
  if (!match) return null;
  if (match.score_a !== null && match.score_b !== null) {
    return (
      <span className="text-center text-sm font-semibold tabular-nums">
        {formatNumber(match.score_a, locale)} - {formatNumber(match.score_b, locale)}
      </span>
    );
  }
  return <span className="text-center text-xs font-medium text-muted-foreground">VS</span>;
}

function TeamPreview({
  name,
  logo,
  align = "start",
}: {
  name: string | null;
  logo: string | null;
  align?: "start" | "end";
}) {
  const safeName = name || "TBD";
  return (
    <div
      className={
        align === "end"
          ? "flex min-w-0 flex-row-reverse items-center gap-2 text-end"
          : "flex min-w-0 items-center gap-2"
      }
    >
      <TeamLogo name={safeName} logo={logo} />
      <span className="min-w-0 truncate text-sm font-medium" dir="auto">
        {safeName}
      </span>
    </div>
  );
}

function TeamLogo({ name, logo }: { name: string; logo: string | null }) {
  const [failed, setFailed] = useState(false);
  const safe = safeUrlOrUndefined(logo);
  // The logo proxy 404s for any crest the bot has not warmed into the shared
  // cache yet; without an onError fallback that surfaces as a broken-image icon.
  // Mirror the match-list Logo: validate the URL and degrade to clean initials.
  if (!safe || failed) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-[0.65rem] font-semibold text-muted-foreground">
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
      className="size-8 shrink-0 rounded-md bg-background/70 object-contain p-1"
    />
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

export function GameIcon({ slug }: { slug: string }) {
  const Icon =
    slug === "fighters"
      ? SwordsIcon
      : [
            "counterstrike",
            "cs2",
            "valorant",
            "callofduty",
            "warzone",
            "rainbowsix",
            "apexlegends",
            "fortnite",
            "pubg",
            "pubgmobile",
            "freefire",
            "crossfire",
          ].includes(slug)
        ? CrosshairIcon
        : Gamepad2Icon;
  return <Icon className="size-3.5" aria-hidden />;
}

export function SourceIcon({ source }: { source: string }) {
  return (
    <span className="grid size-4 place-items-center rounded bg-muted text-[0.5rem] font-bold uppercase text-muted-foreground">
      {source === "startgg" ? "S" : source === "liquipedia" ? "L" : source.slice(0, 1)}
    </span>
  );
}

export function TournamentMark({ slug, source }: { slug: string; source: string }) {
  return (
    <div className="relative grid size-12 shrink-0 place-items-center rounded-xl border bg-background/70 text-primary">
      <GameIcon slug={slug} />
      <span className="absolute -bottom-1 -end-1 rounded-md border bg-card px-1 py-0.5">
        <SourceIcon source={source} />
      </span>
    </div>
  );
}

function ArrowCue() {
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background/40 text-muted-foreground transition-colors group-hover:text-primary">
      <ArrowRightIcon className="size-4 rtl:rotate-180" />
    </div>
  );
}
