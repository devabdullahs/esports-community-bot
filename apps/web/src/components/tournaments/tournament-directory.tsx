"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  Gamepad2Icon,
  ListFilterIcon,
  RadioIcon,
  SearchIcon,
  TrophyIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  CompetitionStatusBadge,
  FixtureRow,
  TournamentIdentity,
} from "@/components/tournaments/competition-primitives";
import {
  GameIcon,
  SourceIcon,
  TournamentMark,
} from "@/components/tournaments/competition-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copy, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import {
  filterTournamentDirectory,
  parseTournamentDirectoryFilters,
  serializeTournamentDirectoryFilters,
  tournamentDirectoryFilterCounts,
  tournamentDirectoryStats,
  tournamentPrimaryStatus,
  type NormalizedTournamentDirectoryFilters,
  type TournamentDirectoryItem,
  type TournamentStatusFilter,
} from "@/lib/tournament-directory";

type FilterOption = { value: string; label: string };

export { GameIcon, SourceIcon, TournamentMark };

export function TournamentDirectory({
  locale,
  heading,
  tournaments,
  archiveHref = null,
  archived = false,
  filterUniverse,
  serverFiltered = false,
  resultTotal,
}: {
  locale: Locale;
  heading: string;
  tournaments: TournamentDirectoryItem[];
  archiveHref?: string | null;
  archived?: boolean;
  filterUniverse?: TournamentDirectoryItem[];
  serverFiltered?: boolean;
  resultTotal?: number;
}) {
  const text = copy[locale].tournaments;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const universe = filterUniverse ?? tournaments;
  const gameOptions = useMemo<FilterOption[]>(
    () =>
      uniqueOptions(
        universe.map((tournament) => ({
          value: tournament.game ?? "other",
          label: tournament.gameTitle,
        })),
      ),
    [universe],
  );
  const sourceOptions = useMemo<FilterOption[]>(
    () =>
      uniqueOptions(
        universe.map((tournament) => ({
          value: tournament.source,
          label: tournament.sourceLabel,
        })),
      ),
    [universe],
  );
  const filters = useMemo(
    () =>
      parseTournamentDirectoryFilters(searchParams, {
        games: gameOptions.map((option) => option.value),
        sources: sourceOptions.map((option) => option.value),
      }),
    [gameOptions, searchParams, sourceOptions],
  );
  const [immediateQuery, setImmediateQuery] = useState(filters.query);
  const stats = useMemo(() => tournamentDirectoryStats(universe), [universe]);
  const counts = useMemo(
    () => tournamentDirectoryFilterCounts(universe, filters),
    [filters, universe],
  );
  const filtered = useMemo(
    () => serverFiltered ? tournaments : filterTournamentDirectory(tournaments, filters),
    [filters, serverFiltered, tournaments],
  );
  const [live, directory] = useMemo(() => {
    const liveItems: TournamentDirectoryItem[] = [];
    const directoryItems: TournamentDirectoryItem[] = [];
    for (const tournament of filtered) {
      if (tournamentPrimaryStatus(tournament) === "live") {
        liveItems.push(tournament);
      } else {
        directoryItems.push(tournament);
      }
    }
    return [liveItems, directoryItems];
  }, [filtered]);
  const appliedHasFilters =
    filters.query !== "" ||
    filters.status !== "all" ||
    filters.game !== "all" ||
    filters.source !== "all";
  const immediateHasFilters =
    immediateQuery !== "" ||
    filters.status !== "all" ||
    filters.game !== "all" ||
    filters.source !== "all";

  function navigate(
    patch: Partial<NormalizedTournamentDirectoryFilters>,
    behavior: "push" | "replace" = "push",
  ) {
    const params = serializeTournamentDirectoryFilters(
      { ...filters, ...patch },
      new URLSearchParams(searchParams.toString()),
    );
    const href = params.size ? `${pathname}?${params}` : pathname;
    startTransition(() => router[behavior](href, { scroll: false }));
  }

  function clearFilters() {
    setImmediateQuery("");
    navigate({ query: "", status: "all", game: "all", source: "all" });
  }

  const statusOptions: Array<{
    value: TournamentStatusFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: text.allStatuses, count: counts.statuses.all },
    { value: "live", label: text.live, count: counts.statuses.live },
    { value: "upcoming", label: text.upcoming, count: counts.statuses.upcoming },
    { value: "results", label: text.results, count: counts.statuses.results },
  ];

  return (
    <div className="flex flex-col gap-7">
      <CompetitionMasthead
        locale={locale}
        heading={heading}
        archiveHref={archiveHref}
        archived={archived}
        stats={stats}
      />

      {live.length ? (
        <section aria-labelledby="live-competitions-title" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="live-competitions-title" className="inline-flex items-center gap-2 text-lg font-semibold">
              <RadioIcon className="size-4 text-primary" />
              {text.liveNow}
            </h2>
            <Badge variant="secondary">{formatNumber(live.length, locale)}</Badge>
          </div>
          <TournamentGrid locale={locale} tournaments={live} live />
        </section>
      ) : null}

      <TournamentFilters
        locale={locale}
        filters={filters}
        gameOptions={gameOptions}
        sourceOptions={sourceOptions}
        statusOptions={statusOptions}
        gameCounts={new Map(counts.games.map((option) => [option.value, option.count]))}
        sourceCounts={new Map(counts.sources.map((option) => [option.value, option.count]))}
        allGames={counts.allGames}
        allSources={counts.allSources}
        showing={filtered.length}
        total={resultTotal ?? universe.length}
        pending={isPending}
        hasFilters={immediateHasFilters}
        onImmediateQueryChange={setImmediateQuery}
        onNavigate={navigate}
        onClear={clearFilters}
      />

      {directory.length ? (
        <TournamentGrid
          locale={locale}
          tournaments={directory}
          ariaLabel={archived ? text.archiveTitle : text.trackedTournaments}
        />
      ) : live.length ? null : (
        <Empty className="min-h-56 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>{appliedHasFilters ? text.noFiltered : archived ? text.archiveEmpty : text.empty}</EmptyTitle>
            <EmptyDescription>
              {appliedHasFilters ? text.searchPlaceholder : text.description}
            </EmptyDescription>
          </EmptyHeader>
          {appliedHasFilters ? (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <XIcon data-icon="inline-start" />
                {text.clearFilters}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </div>
  );
}

function CompetitionMasthead({
  locale,
  heading,
  archiveHref,
  archived,
  stats,
}: {
  locale: Locale;
  heading: string;
  archiveHref: string | null;
  archived: boolean;
  stats: ReturnType<typeof tournamentDirectoryStats>;
}) {
  const text = copy[locale].tournaments;
  return (
    <section className="border-b pb-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-3xl flex-col gap-3">
          <Badge variant="outline" className="w-fit">
            <TrophyIcon data-icon="inline-start" />
            {archived ? text.archivedBadge : text.eyebrow}
          </Badge>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{heading}</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              {archived ? text.archiveDescription : text.description}
            </p>
          </div>
          {archiveHref ? (
            <Button
              render={<Link href={archiveHref} />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="w-fit"
            >
              {archived ? text.activeLink : text.archiveLink}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[31rem]">
          <StatFact icon={TrophyIcon} label={text.trackedTournaments} value={stats.tournaments} locale={locale} />
          <StatFact icon={Gamepad2Icon} label={text.trackedGames} value={stats.games} locale={locale} />
          <StatFact icon={RadioIcon} label={text.liveTournaments} value={stats.live} locale={locale} />
          <StatFact icon={CalendarDaysIcon} label={text.upcomingTournaments} value={stats.upcoming} locale={locale} />
        </div>
      </div>
    </section>
  );
}

function TournamentFilters({
  locale,
  filters,
  gameOptions,
  sourceOptions,
  statusOptions,
  gameCounts,
  sourceCounts,
  allGames,
  allSources,
  showing,
  total,
  pending,
  hasFilters,
  onImmediateQueryChange,
  onNavigate,
  onClear,
}: {
  locale: Locale;
  filters: NormalizedTournamentDirectoryFilters;
  gameOptions: FilterOption[];
  sourceOptions: FilterOption[];
  statusOptions: Array<{ value: TournamentStatusFilter; label: string; count: number }>;
  gameCounts: Map<string, number>;
  sourceCounts: Map<string, number>;
  allGames: number;
  allSources: number;
  showing: number;
  total: number;
  pending: boolean;
  hasFilters: boolean;
  onImmediateQueryChange: (query: string) => void;
  onNavigate: (
    patch: Partial<NormalizedTournamentDirectoryFilters>,
    behavior?: "push" | "replace",
  ) => void;
  onClear: () => void;
}) {
  const text = copy[locale].tournaments;
  return (
    <section aria-labelledby="tournament-filters-title" className="flex flex-col gap-4 border-y py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tournament-filters-title" className="inline-flex items-center gap-2 text-sm font-medium">
          <ListFilterIcon className="size-4 text-primary" />
          {text.filters}
        </h2>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {text.showing} {formatNumber(showing, locale)} / {formatNumber(total, locale)}
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(16rem,1fr)_auto_auto]">
        <TournamentSearchField
          value={filters.query}
          placeholder={text.searchPlaceholder}
          onImmediateQueryChange={onImmediateQueryChange}
          onNavigate={onNavigate}
        />

        <div>
          <Label id="tournament-game-filter-label" className="sr-only">
            {text.allGames}
          </Label>
          <Select value={filters.game} onValueChange={(value) => onNavigate({ game: value ?? "all" })}>
            <SelectTrigger className="h-9 w-full xl:w-52" aria-labelledby="tournament-game-filter-label">
              <SelectValue>
                {(value) => {
                  const option = gameOptions.find((item) => item.value === value);
                  return value === "all" ? text.allGames : option?.label ?? text.allGames;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value="all">
                  {text.allGames} ({formatNumber(allGames, locale)})
                </SelectItem>
                {gameOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <GameIcon slug={option.value} />
                    {option.label} ({formatNumber(gameCounts.get(option.value) ?? 0, locale)})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label id="tournament-source-filter-label" className="sr-only">
            {text.allSources}
          </Label>
          <Select value={filters.source} onValueChange={(value) => onNavigate({ source: value ?? "all" })}>
            <SelectTrigger className="h-9 w-full xl:w-48" aria-labelledby="tournament-source-filter-label">
              <SelectValue>
                {(value) => {
                  const option = sourceOptions.find((item) => item.value === value);
                  return value === "all" ? text.allSources : option?.label ?? text.allSources;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value="all">
                  {text.allSources} ({formatNumber(allSources, locale)})
                </SelectItem>
                {sourceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <SourceIcon source={option.value} />
                    {option.label} ({formatNumber(sourceCounts.get(option.value) ?? 0, locale)})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          value={[filters.status]}
          onValueChange={(values) => values[0] && onNavigate({ status: values[0] as TournamentStatusFilter })}
          variant="outline"
          spacing={0}
          aria-label={text.allStatuses}
          className="max-w-full overflow-x-auto"
        >
          {statusOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="shrink-0 gap-1.5 px-2.5">
              {option.label}
              <span className="text-[0.68rem] tabular-nums text-muted-foreground">
                {formatNumber(option.count, locale)}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={pending}>
            <XIcon data-icon="inline-start" />
            {text.clearFilters}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function TournamentSearchField({
  value,
  placeholder,
  onImmediateQueryChange,
  onNavigate,
}: {
  value: string;
  placeholder: string;
  onImmediateQueryChange: (query: string) => void;
  onNavigate: (
    patch: Partial<NormalizedTournamentDirectoryFilters>,
    behavior?: "push" | "replace",
  ) => void;
}) {
  const [query, setQuery] = useState(value);
  const deferredQuery = useDeferredValue(query);
  const locallyEdited = useRef(false);
  const requestedQuery = useRef(value);

  useEffect(() => {
    if (value === requestedQuery.current && query === value) {
      locallyEdited.current = false;
      return;
    }
    if (!locallyEdited.current && value !== requestedQuery.current) {
      requestedQuery.current = value;
      setQuery(value);
      onImmediateQueryChange(value);
    }
  }, [onImmediateQueryChange, query, value]);

  useEffect(() => {
    if (
      !locallyEdited.current ||
      deferredQuery === value ||
      requestedQuery.current === deferredQuery
    ) {
      return;
    }
    requestedQuery.current = deferredQuery;
    onNavigate({ query: deferredQuery }, "replace");
  }, [deferredQuery, onNavigate, value]);

  return (
    <div className="min-w-0">
      <Label htmlFor="tournament-search" className="sr-only">
        {placeholder}
      </Label>
      <InputGroup className="h-9">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          id="tournament-search"
          value={query}
          onChange={(event) => {
            locallyEdited.current = true;
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            onImmediateQueryChange(nextQuery);
          }}
          placeholder={placeholder}
          maxLength={120}
        />
      </InputGroup>
    </div>
  );
}

const TournamentGrid = memo(function TournamentGrid({
  locale,
  tournaments,
  live = false,
  ariaLabel,
}: {
  locale: Locale;
  tournaments: TournamentDirectoryItem[];
  live?: boolean;
  ariaLabel?: string;
}) {
  const panels = tournaments.map((tournament) => (
    <TournamentPanel
      key={tournament.id}
      locale={locale}
      tournament={tournament}
      live={live}
    />
  ));
  return ariaLabel ? (
    <section aria-label={ariaLabel} className="grid gap-3 lg:grid-cols-2">
      {panels}
    </section>
  ) : (
    <div className="grid gap-3 lg:grid-cols-2">{panels}</div>
  );
});

const TournamentPanel = memo(function TournamentPanel({
  locale,
  tournament,
  live = false,
}: {
  locale: Locale;
  tournament: TournamentDirectoryItem;
  live?: boolean;
}) {
  const text = copy[locale].tournaments;
  const status = tournamentPrimaryStatus(tournament);
  const match = tournament.featuredMatch;
  return (
    <article className="flex min-w-0 flex-col rounded-lg border bg-card">
      <Link
        href={localizedPath(`/tournaments/${tournament.id}`, locale)}
        className="group flex items-start justify-between gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TournamentIdentity
          name={tournament.name}
          id={tournament.id}
          game={tournament.game ?? "other"}
          gameTitle={tournament.gameTitle}
          source={tournament.source}
          sourceLabel={tournament.sourceLabel}
          locale={locale}
        />
        <div className="flex shrink-0 flex-col items-end gap-2">
          <CompetitionStatusBadge status={status} locale={locale} />
          <ArrowRightIcon className="size-4 text-muted-foreground transition-colors group-hover:text-primary rtl:rotate-180" />
        </div>
      </Link>
      <div className="border-t px-4">
        {match ? (
          <FixtureRow
            match={match}
            locale={locale}
            status={live ? "live" : undefined}
            label={
              status === "upcoming"
                ? text.nextMatch
                : status === "results"
                  ? text.latestResult
                  : text.featuredMatch
            }
          />
        ) : (
          <p className="py-4 text-sm text-muted-foreground">{text.noMatches}</p>
        )}
      </div>
      <div className="grid grid-cols-3 border-t text-center text-xs text-muted-foreground">
        <Metric label={text.live} value={tournament.matchCounts.running} locale={locale} />
        <Metric label={text.upcoming} value={tournament.matchCounts.scheduled} locale={locale} />
        <Metric label={text.results} value={tournament.matchCounts.finished} locale={locale} />
      </div>
    </article>
  );
});

function Metric({ label, value, locale }: { label: string; value: number; locale: Locale }) {
  return (
    <div className="border-e px-2 py-2 last:border-e-0">
      <span className="font-semibold tabular-nums text-foreground">{formatNumber(value, locale)}</span>
      <span className="ms-1.5">{label}</span>
    </div>
  );
}

function StatFact({
  icon: Icon,
  label,
  value,
  locale,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  locale: Locale;
}) {
  return (
    <div className="border-s-2 border-primary/45 px-3 py-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 text-primary" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(value, locale)}</div>
    </div>
  );
}

function uniqueOptions(options: FilterOption[]): FilterOption[] {
  const byValue = new Map<string, FilterOption>();
  for (const option of options) {
    if (!byValue.has(option.value)) byValue.set(option.value, option);
  }
  return [...byValue.values()].sort((a, b) => a.label.localeCompare(b.label));
}
