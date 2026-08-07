"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RadioIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useState, useSyncExternalStore } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalDateTime } from "@/components/local-date-time";
import { PlatformIcon } from "@/components/platform-icon";
import { BracketView } from "@/components/tournaments/bracket-view";
import { MatchReminderButton } from "@/components/tournaments/match-reminder-button";
import { copy, directionForLocale, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
import {
  matchOutcomeLabel,
  matchStatusLabel,
  matchWinner,
  type MatchStatus,
  type MatchWinner,
  type ResultReason,
  type WinnerSide,
} from "@/lib/match-lifecycle";
import { withProfileReturn, type ProfileReturnContext } from "@/lib/profile-navigation";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { projectTournamentBracket, type TournamentBracket } from "@/lib/tournament-brackets";
import type { TournamentDraw } from "@/lib/tournament-draw";

/** A draw with no label projection behind it still renders; the view only needs one source. */
const EMPTY_BRACKET: TournamentBracket = { rounds: [] };
import { cn } from "@/lib/utils";

type TournamentCopy = (typeof copy)[Locale]["tournaments"];
type PublicSyncHealth = {
  state: "fresh" | "delayed" | "unavailable" | "final";
  lastSuccessAt: number | null;
  source: "liquipedia" | "startgg" | "pandascore";
};

type MatchRow = {
  id: number;
  name: string | null;
  team_a: string | null;
  team_b: string | null;
  team_a_id?: number | null;
  team_b_id?: number | null;
  team_a_profile_id?: number | null;
  team_b_profile_id?: number | null;
  team_a_profile_type?: "team" | "player" | null;
  team_b_profile_type?: "team" | "player" | null;
  logo_a: string | null;
  logo_b: string | null;
  score_a: number | null;
  score_b: number | null;
  status: MatchStatus;
  winner_side?: WinnerSide;
  result_reason?: ResultReason;
  round?: string | null;
  scheduled_at: number | null;
  updated_at: string | null;
  has_details?: boolean;
  stream?: { platform: string; url: string } | null;
  coStreams?: { platform: string; handle: string; label: string; url: string | null }[];
};

type StandingRow = {
  id: number;
  section: string;
  rank: number;
  team: string;
  team_id?: number | null;
  profile_id?: number | null;
  profile_type?: "team" | "player" | null;
  logo: string | null;
  points: string;
  extra: string;
  ewc_points?: number;
};

export type TournamentMatchesPayload = {
  tournament: {
    id: number;
    name: string | null;
    game: string | null;
    source: string;
    url: string | null;
    ewc: boolean;
    completed: boolean;
    final_standings_section: string | null;
    syncHealth: PublicSyncHealth;
  };
  matches: {
    running: MatchRow[];
    scheduled: MatchRow[];
    finished: MatchRow[];
    postponed: MatchRow[];
    cancelled: MatchRow[];
  };
  bracketMatches?: MatchRow[];
  draw?: TournamentDraw | null;
  standings?: StandingRow[];
  totals: {
    running: number;
    scheduled: number;
    finished: number;
    postponed: number;
    cancelled: number;
    all: number;
  };
  finishedPage: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  total: number;
};

export type TournamentResultsNavigation = {
  newestHref: string;
  previousHref: string | null;
  nextHref: string | null;
};

// Match data is local DB state, not a source-site request. Official Overwatch
// sheets can update every few seconds while other providers remain on the
// lighter 90-second cadence.
const REFETCH_INTERVAL_MS = 90_000;
const OFFICIAL_OVERWATCH_REFETCH_INTERVAL_MS = 15_000;
const NUMBER_LOCALE: Record<Locale, string> = { en: "en-US", ar: "ar-SA" };

export function shouldPollTournamentMatches(data: TournamentMatchesPayload): boolean {
  if (data.tournament.syncHealth.state === "final") return false;
  if (
    data.tournament.completed
    && data.matches.running.length === 0
    && data.matches.scheduled.length === 0
    && data.matches.postponed.length === 0
  ) {
    return false;
  }
  return true;
}

export function tournamentMatchesRefetchInterval(
  data: TournamentMatchesPayload,
): number | false {
  if (!shouldPollTournamentMatches(data)) return false;
  return data.tournament.source === "official" && data.tournament.game === "overwatch"
    ? OFFICIAL_OVERWATCH_REFETCH_INTERVAL_MS
    : REFETCH_INTERVAL_MS;
}

export function mergeBracketMatchSnapshot(
  initialMatches: MatchRow[],
  refreshedMatches: MatchRow[],
): MatchRow[] {
  const refreshedById = new Map(refreshedMatches.map((match) => [match.id, match]));
  const merged = initialMatches.map((match) => refreshedById.get(match.id) ?? match);
  const knownIds = new Set(initialMatches.map((match) => match.id));
  for (const match of refreshedMatches) {
    if (!knownIds.has(match.id)) merged.push(match);
  }
  return merged;
}

export function tournamentMatchesQueryKey(
  tournamentId: number,
  data: TournamentMatchesPayload,
) {
  return [
    "tournament-matches",
    tournamentId,
    data.finishedPage.offset,
    data.finishedPage.limit,
  ] as const;
}

export async function fetchTournamentMatchesPage(
  tournamentId: number,
  initialData: TournamentMatchesPayload,
): Promise<TournamentMatchesPayload> {
  const params = new URLSearchParams({
    limit: String(initialData.finishedPage.limit),
    offset: String(initialData.finishedPage.offset),
  });
  const response = await fetch(`/api/tournaments/${tournamentId}/matches?${params}`);
  if (!response.ok) throw new Error("Failed to load matches");
  const refreshed = await response.json() as TournamentMatchesPayload;
  if (
    initialData.finishedPage.offset > 0
    && refreshed.totals.finished !== initialData.totals.finished
  ) {
    return {
      ...refreshed,
      matches: {
        ...refreshed.matches,
        finished: initialData.matches.finished,
      },
      finishedPage: initialData.finishedPage,
    };
  }
  return refreshed;
}

export function TournamentRefreshFailureAlert({
  locale,
  lastSuccessfulRefresh,
  onRetry,
}: {
  locale: Locale;
  lastSuccessfulRefresh: string | null;
  onRetry: () => void;
}) {
  const text = copy[locale].tournaments;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{text.pageRefreshFailed}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 pe-0 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {text.pageRefreshRetained}
          {lastSuccessfulRefresh ? (
            <>
              {" "}
              {text.pageRefreshLastSuccess}:{" "}
              <LocalDateTime
                value={lastSuccessfulRefresh}
                locale={locale}
                fallback={text.syncTimestampLoading}
              />
            </>
          ) : null}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={onRetry}
        >
          <RefreshCwIcon data-icon="inline-start" />
          {text.retryRefresh}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function useHasHydrated() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

function teamLabel(value: string | null, fallback: string) {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function Logo({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const safe = safeUrlOrUndefined(url);
  if (!safe || failed) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-[0.6rem] font-semibold uppercase text-muted-foreground">
        {alt.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoProxyUrl(safe)}
      alt=""
      loading="lazy"
      className="size-6 shrink-0 rounded object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function ScoreText({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="tabular-nums font-semibold">
      {a} <span className="text-muted-foreground">-</span> {b}
    </span>
  );
}

function ResultScoreText({
  match,
  winner,
  locale,
  drawLabel,
}: {
  match: MatchRow;
  winner: MatchWinner;
  locale: Locale;
  drawLabel: string;
}) {
  if (match.score_a == null || match.score_b == null) {
    return <span className="text-muted-foreground">{matchOutcomeLabel(match, locale)}</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 tabular-nums font-semibold">
      <span className={winner === "a" ? "text-primary" : "text-foreground"}>{match.score_a}</span>
      <span className="text-muted-foreground">-</span>
      <span className={winner === "b" ? "text-primary" : "text-foreground"}>{match.score_b}</span>
      {winner === "draw" ? (
        <span className="rounded-full border border-border px-2 py-0.5 text-[0.65rem] text-muted-foreground">
          {drawLabel}
        </span>
      ) : null}
    </span>
  );
}

function MatchTime({ value, locale, fallback }: { value: number | null; locale: Locale; fallback: string }) {
  if (value == null || !Number.isFinite(value)) return <span>{fallback}</span>;
  return <LocalDateTime value={new Date(value * 1000).toISOString()} locale={locale} />;
}

function MatchDetailsLink({
  match,
  locale,
  text,
  centered = false,
}: {
  match: MatchRow;
  locale: Locale;
  text: TournamentCopy;
  centered?: boolean;
}) {
  return (
    <Link
      href={localizedPath(`/matches/${match.id}`, locale)}
      className={cn(
        "text-xs font-medium text-primary underline-offset-4 hover:underline",
        centered && "flex w-full justify-center px-3 py-1.5 text-center",
      )}
    >
      {text.matchDetails}
    </Link>
  );
}

// Team label that links to the team's profile page when the server resolved an
// unambiguous PandaScore team id for the name; plain text otherwise.
function TeamName({
  label,
  teamId,
  profileId,
  profileType,
  locale,
  bold,
  returnContext,
}: {
  label: string;
  teamId?: number | null;
  profileId?: number | null;
  profileType?: "team" | "player" | null;
  locale: Locale;
  bold?: boolean;
  returnContext?: ProfileReturnContext | null;
}) {
  const className = `min-w-0 truncate ${bold ? "font-bold text-foreground" : ""}`;
  const resolvedId = profileId ?? teamId;
  const resolvedType = profileType ?? (teamId ? "team" : null);
  if (!resolvedId || !resolvedType) return <bdi className={className}>{label}</bdi>;
  return (
    <Link
      href={withProfileReturn(`/${resolvedType === "player" ? "players" : "teams"}/${resolvedId}`, locale, returnContext)}
      className={`${className} underline-offset-4 hover:text-primary hover:underline`}
    >
      <bdi>{label}</bdi>
    </Link>
  );
}

function MatchText({
  a,
  b,
  aId,
  bId,
  aProfileId,
  bProfileId,
  aProfileType,
  bProfileType,
  logoA,
  logoB,
  locale,
  tbd,
  vs,
  winner,
  returnContext,
}: {
  a: string | null;
  b: string | null;
  aId?: number | null;
  bId?: number | null;
  aProfileId?: number | null;
  bProfileId?: number | null;
  aProfileType?: "team" | "player" | null;
  bProfileType?: "team" | "player" | null;
  logoA?: string | null;
  logoB?: string | null;
  locale: Locale;
  tbd: string;
  vs: string;
  winner?: MatchWinner;
  returnContext?: ProfileReturnContext | null;
}) {
  const aLabel = teamLabel(a, tbd);
  const bLabel = teamLabel(b, tbd);
  return (
    <span dir={directionForLocale(locale)} className="flex w-full max-w-full items-center gap-2 text-start">
      <span className="flex min-w-0 items-center gap-1.5">
        <Logo url={logoA ?? null} alt={aLabel} />
        <TeamName
          label={aLabel}
          teamId={aId}
          profileId={aProfileId}
          profileType={aProfileType}
          locale={locale}
          bold={winner === "a"}
          returnContext={returnContext}
        />
      </span>
      <span className="shrink-0 text-muted-foreground">{vs}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <TeamName
          label={bLabel}
          teamId={bId}
          profileId={bProfileId}
          profileType={bProfileType}
          locale={locale}
          bold={winner === "b"}
          returnContext={returnContext}
        />
        <Logo url={logoB ?? null} alt={bLabel} />
      </span>
    </span>
  );
}

function isLobbySchedule(match: MatchRow) {
  return teamLabel(match.team_b, "").toLowerCase() === "lobby" && !match.logo_b;
}

function LobbyScheduleText({ match, fallback, locale }: { match: MatchRow; fallback: string; locale: Locale }) {
  return (
    <span
      className="flex w-full min-w-0 items-center gap-2 text-start text-sm font-medium"
      dir={directionForLocale(locale)}
    >
      <bdi className="min-w-0 truncate">{match.name || teamLabel(match.team_a, fallback)}</bdi>
    </span>
  );
}

function localDayKey(timestamp: number | null) {
  if (timestamp == null || !Number.isFinite(timestamp)) return "tbd";
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatDayHeading(timestamp: number | null, locale: Locale, text: TournamentCopy) {
  if (timestamp == null || !Number.isFinite(timestamp)) return text.timeTbd;

  const date = new Date(timestamp * 1000);
  const today = localDayStart(new Date());
  const day = localDayStart(date);
  const oneDay = 24 * 60 * 60 * 1000;

  if (day === today) return text.today;
  if (day === today + oneDay) return text.tomorrow;

  return new Intl.DateTimeFormat(NUMBER_LOCALE[locale], {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function groupMatchesByLocalDay(matches: MatchRow[], locale: Locale, text: TournamentCopy, enabled: boolean) {
  if (!enabled) return [{ key: "all", label: null as string | null, matches }];

  const groups = new Map<string, { key: string; label: string; matches: MatchRow[] }>();
  for (const match of matches) {
    const key = localDayKey(match.scheduled_at);
    const current = groups.get(key);
    if (current) {
      current.matches.push(match);
    } else {
      groups.set(key, {
        key,
        label: formatDayHeading(match.scheduled_at, locale, text),
        matches: [match],
      });
    }
  }
  return [...groups.values()];
}

function DayHeadingRow({ label, columns }: { label: string | null; columns: number }) {
  if (!label) return null;
  return (
    <TableRow className="border-b-0 hover:bg-transparent">
      <TableCell colSpan={columns} className="px-0 pb-1 pt-5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </TableCell>
    </TableRow>
  );
}

export function TournamentMatchList({
  tournamentId,
  locale,
  initialData,
  reminderState = { signedIn: false, reminderMatchIds: [] },
  callbackPath,
  resultsNavigation,
}: {
  tournamentId: number;
  locale: Locale;
  initialData: TournamentMatchesPayload;
  reminderState?: { signedIn: boolean; reminderMatchIds: number[] };
  callbackPath?: string;
  resultsNavigation?: TournamentResultsNavigation;
}) {
  const hasHydrated = useHasHydrated();
  const text = copy[locale].tournaments;
  const query = useQuery<TournamentMatchesPayload>({
    queryKey: tournamentMatchesQueryKey(tournamentId, initialData),
    queryFn: () => fetchTournamentMatchesPage(tournamentId, initialData),
    initialData,
    staleTime: 0,
    refetchOnMount: false,
    refetchInterval: (current) => {
      const data = current.state.data as TournamentMatchesPayload | undefined;
      return data ? tournamentMatchesRefetchInterval(data) : false;
    },
    refetchOnReconnect: (current) => {
      const data = current.state.data as TournamentMatchesPayload | undefined;
      return data ? shouldPollTournamentMatches(data) : true;
    },
    refetchOnWindowFocus: (current) => {
      const data = current.state.data as TournamentMatchesPayload | undefined;
      return data ? shouldPollTournamentMatches(data) : true;
    },
  });

  const data = query.data ?? initialData;
  const { running, scheduled, finished, postponed, cancelled } = data.matches;
  const standings = data.standings ?? [];
  const returnContext: ProfileReturnContext = {
    type: "tournament",
    href: `/tournaments/${data.tournament.id}`,
    label: data.tournament.name || `#${data.tournament.id}`,
  };
  const scheduledGroups = groupMatchesByLocalDay(scheduled, locale, text, hasHydrated);
  const finishedGroups = groupMatchesByLocalDay(finished, locale, text, hasHydrated);
  const initialBracketMatches = initialData.bracketMatches
    ?? [
      ...initialData.matches.running,
      ...initialData.matches.scheduled,
      ...initialData.matches.finished,
      ...initialData.matches.postponed,
      ...initialData.matches.cancelled,
    ];
  const bracketMatches = mergeBracketMatchSnapshot(
    initialBracketMatches,
    [...running, ...scheduled, ...finished, ...postponed, ...cancelled],
  );
  const bracket = projectTournamentBracket(bracketMatches);
  // The workbook draw carries the real feeder edges; a label-projected bracket carries none.
  // Either is enough to render, so the section shows whenever one of them exists.
  //
  // Fall back to the server-rendered draw rather than to nothing: a response that omits it
  // means "no fresher copy", not "this tournament stopped having a bracket", and dropping it
  // unmounted the whole section mid-visit.
  const draw = data.draw ?? initialData.draw ?? null;
  const tbd = text.tbd;
  const reminderMatchIds = new Set(reminderState.reminderMatchIds);
  const reminderCallbackPath = callbackPath
    ?? localizedPath(`/tournaments/${data.tournament.id}`, locale);
  // Standings-format events (battle royale, TFT groups) often have zero
  // head-to-head matches; the standings ARE the tournament, so skip the empty
  // match sections instead of stacking three "no matches" placeholders.
  const standingsOnly = standings.length > 0 && data.totals.all === 0;
  const historyChanged = initialData.finishedPage.offset > 0
    && data.totals.finished !== initialData.totals.finished;
  const resultStart = finished.length > 0 ? data.finishedPage.offset + 1 : 0;
  const resultEnd = finished.length > 0
    ? Math.min(data.finishedPage.offset + finished.length, data.totals.finished)
    : 0;
  const lifecycleUpdates = [...postponed, ...cancelled].sort((a, b) => {
    const aTime = a.scheduled_at ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduled_at ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.id - b.id;
  });
  const retainedRefreshError = query.isRefetchError;
  const lastSuccessfulRefresh = query.dataUpdatedAt > 0
    ? new Date(query.dataUpdatedAt).toISOString()
    : null;

  return (
    <div className="flex flex-col gap-8">
      {retainedRefreshError ? (
        <TournamentRefreshFailureAlert
          locale={locale}
          lastSuccessfulRefresh={lastSuccessfulRefresh}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {standings.length ? (
        <StandingsSection
          standings={standings}
          running={running}
           finalSection={data.tournament.final_standings_section}
          locale={locale}
          text={text}
          returnContext={returnContext}
        />
      ) : null}

      {standingsOnly ? null : (
        <>
      {standings.length ? <Separator /> : null}
      {draw || bracket ? (
        <>
          <BracketView bracket={bracket ?? EMPTY_BRACKET} draw={draw} locale={locale} />
          <Separator />
        </>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <RadioIcon className="size-4 text-primary" />
          {text.liveNow}
        </h2>
        {running.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {running.map((m) => (
              <Card id={`tournament-match-${m.id}`} key={m.id} size="sm" className="flex flex-col">
                {isLobbySchedule(m) ? (
                  <CardContent className="flex items-center justify-between gap-3 py-2">
                    <LobbyScheduleText match={m} fallback={tbd} locale={locale} />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <MatchTime value={m.scheduled_at} locale={locale} fallback={text.timeTbd} />
                    </span>
                  </CardContent>
                ) : (
                  <CardContent className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 py-1">
                    <div
                      className="flex min-w-0 items-center gap-2 text-start text-sm font-medium"
                      dir={directionForLocale(locale)}
                    >
                      <Logo url={m.logo_a} alt={teamLabel(m.team_a, tbd)} />
                      <TeamName
                        label={teamLabel(m.team_a, tbd)}
                        teamId={m.team_a_id}
                        profileId={m.team_a_profile_id}
                        profileType={m.team_a_profile_type}
                        locale={locale}
                        returnContext={returnContext}
                      />
                    </div>
                    <ScoreText a={m.score_a} b={m.score_b} />
                    <div
                      className="flex min-w-0 items-center justify-end gap-2 text-start text-sm font-medium"
                      dir={directionForLocale(locale)}
                    >
                      <TeamName
                        label={teamLabel(m.team_b, tbd)}
                        teamId={m.team_b_id}
                        profileId={m.team_b_profile_id}
                        profileType={m.team_b_profile_type}
                        locale={locale}
                        returnContext={returnContext}
                      />
                      <Logo url={m.logo_b} alt={teamLabel(m.team_b, tbd)} />
                    </div>
                  </CardContent>
                )}
                <MatchDetailsLink match={m} locale={locale} text={text} centered />
                {m.stream ? (
                  <a
                    href={m.stream.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 border-t px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted/50"
                    title={`${text.watchNow} - ${m.stream.platform}`}
                  >
                    <PlatformIcon platform={m.stream.platform as never} className="size-3.5" />
                    {text.watchNow}
                  </a>
                ) : null}
                {m.coStreams?.length ? (
                  <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
                    <RadioIcon className="size-3 text-primary" />
                    <span>{text.coStreaming}</span>
                    {m.coStreams.map((c) => (
                      <a
                        key={`${c.platform}:${c.handle}`}
                        href={c.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        title={`${c.label} - ${c.platform}`}
                      >
                        <PlatformIcon platform={c.platform as never} className="size-3.5" />
                        <span className="max-w-24 truncate">{c.label}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{text.noLive}</p>
        )}
      </section>

      {lifecycleUpdates.length ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3" aria-labelledby="match-lifecycle-updates">
            <h2 id="match-lifecycle-updates" className="text-lg font-semibold">
              {locale === "ar" ? "تحديثات المباريات" : "Match updates"}
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{text.time}</TableHead>
                  <TableHead>{text.match}</TableHead>
                  <TableHead className="text-end">{text.result}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lifecycleUpdates.map((m) => (
                  <TableRow id={`tournament-match-${m.id}`} key={m.id}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      <MatchTime value={m.scheduled_at} locale={locale} fallback={text.timeTbd} />
                    </TableCell>
                    <TableCell className="text-start">
                      {isLobbySchedule(m) ? (
                        <LobbyScheduleText match={m} fallback={tbd} locale={locale} />
                      ) : (
                        <MatchText
                          a={m.team_a}
                          b={m.team_b}
                          aId={m.team_a_id}
                          bId={m.team_b_id}
                          aProfileId={m.team_a_profile_id}
                          bProfileId={m.team_b_profile_id}
                          aProfileType={m.team_a_profile_type}
                          bProfileType={m.team_b_profile_type}
                          logoA={m.logo_a}
                          logoB={m.logo_b}
                          locale={locale}
                          tbd={tbd}
                          vs={text.vs}
                          returnContext={returnContext}
                        />
                      )}
                      <MatchDetailsLink match={m} locale={locale} text={text} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Badge variant={m.status === "postponed" ? "secondary" : "outline"}>
                        {matchStatusLabel(m.status, locale)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      ) : null}

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{text.upcoming}</h2>
        {scheduled.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{text.time}</TableHead>
                <TableHead>{text.match}</TableHead>
                <TableHead className="w-8 px-1 text-end"><span className="sr-only">{text.reminder}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scheduledGroups.map((group) => (
                <Fragment key={group.key}>
                  <DayHeadingRow label={group.label} columns={3} />
                  {group.matches.map((m) => (
                    <TableRow id={`tournament-match-${m.id}`} key={m.id}>
                      <TableCell className="text-muted-foreground tabular-nums">
                        <MatchTime value={m.scheduled_at} locale={locale} fallback={text.timeTbd} />
                      </TableCell>
                      <TableCell className="text-start">
                        {isLobbySchedule(m) ? (
                          <LobbyScheduleText match={m} fallback={tbd} locale={locale} />
                        ) : (
                          <MatchText
                            a={m.team_a}
                            b={m.team_b}
                            aId={m.team_a_id}
                            bId={m.team_b_id}
                            aProfileId={m.team_a_profile_id}
                            bProfileId={m.team_b_profile_id}
                            aProfileType={m.team_a_profile_type}
                            bProfileType={m.team_b_profile_type}
                            logoA={m.logo_a}
                            logoB={m.logo_b}
                            locale={locale}
                            tbd={tbd}
                            vs={text.vs}
                            returnContext={returnContext}
                          />
                        )}
                        <MatchDetailsLink match={m} locale={locale} text={text} />
                      </TableCell>
                      <TableCell className="px-1 text-end">
                        <MatchReminderButton
                          matchId={m.id}
                          signedIn={reminderState.signedIn}
                          initialReminded={reminderMatchIds.has(m.id)}
                          locale={locale}
                          callbackPath={reminderCallbackPath}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{text.noUpcoming}</p>
        )}
      </section>

      <Separator />

      <section id="results" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {text.results}
            <Badge variant="outline">
              {text.resultsRange(resultStart, resultEnd, data.totals.finished)}
            </Badge>
          </h2>
          {resultsNavigation ? (
            <nav
              aria-label={text.resultsNavigation}
              className="flex max-w-full items-center gap-2"
              dir={directionForLocale(locale)}
            >
              {resultsNavigation.previousHref ? (
                <Button
                  render={<Link href={resultsNavigation.previousHref} />}
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                >
                  <ChevronLeftIcon className="rtl:rotate-180" />
                  {text.previousResults}
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  <ChevronLeftIcon className="rtl:rotate-180" />
                  {text.previousResults}
                </Button>
              )}
              {resultsNavigation.nextHref ? (
                <Button
                  render={<Link href={resultsNavigation.nextHref} />}
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                >
                  {text.nextResults}
                  <ChevronRightIcon className="rtl:rotate-180" />
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  {text.nextResults}
                  <ChevronRightIcon className="rtl:rotate-180" />
                </Button>
              )}
            </nav>
          ) : null}
        </div>
        {historyChanged && resultsNavigation ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>{text.newResultsAvailable}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2 pe-0 sm:flex-row sm:items-center sm:justify-between">
              <span>{text.newResultsRetained}</span>
              <Button
                render={<Link href={resultsNavigation.newestHref} />}
                nativeButton={false}
                variant="outline"
                size="sm"
                className="w-fit"
              >
                {text.viewNewestResults}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {finished.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{text.time}</TableHead>
                <TableHead>{text.match}</TableHead>
                <TableHead className="text-end">{text.result}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {finishedGroups.map((group) => (
                <Fragment key={group.key}>
                  <DayHeadingRow label={group.label} columns={3} />
                  {group.matches.map((m) => {
                    const winner = matchWinner(m);
                    return (
                      <TableRow id={`tournament-match-${m.id}`} key={m.id}>
                        <TableCell className="text-muted-foreground tabular-nums">
                          <MatchTime value={m.scheduled_at} locale={locale} fallback={text.timeTbd} />
                        </TableCell>
                        <TableCell className="text-start">
                          {isLobbySchedule(m) ? (
                            <LobbyScheduleText match={m} fallback={tbd} locale={locale} />
                          ) : (
                            <MatchText
                              a={m.team_a}
                              b={m.team_b}
                              aId={m.team_a_id}
                              bId={m.team_b_id}
                              aProfileId={m.team_a_profile_id}
                              bProfileId={m.team_b_profile_id}
                              aProfileType={m.team_a_profile_type}
                              bProfileType={m.team_b_profile_type}
                              logoA={m.logo_a}
                              logoB={m.logo_b}
                              locale={locale}
                              tbd={tbd}
                              vs={text.vs}
                              winner={winner}
                              returnContext={returnContext}
                            />
                          )}
                          <MatchDetailsLink match={m} locale={locale} text={text} />
                        </TableCell>
                        <TableCell className="text-end">
                          <ResultScoreText
                            match={m}
                            winner={winner}
                            locale={locale}
                            drawLabel={text.draw}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{text.noResults}</p>
        )}
      </section>

      {data.totals.all === 0 ? (
        <p className="text-sm text-muted-foreground">{text.noMatches}</p>
      ) : null}
        </>
      )}
    </div>
  );
}

// True when a points/score cell carries an actual result (any non-zero digit),
// so "0", "0-0", "0–0", "-", and "" all count as no result yet.
function hasNumericResult(value: string | null | undefined): boolean {
  return /[1-9]/.test(String(value ?? ""));
}

// Section-grouped standings (battle-royale point tables, TFT groups). Section
// titles come from the Liquipedia page headings ("Group A", stage names).
// Before any matches are played every row is 0–0, so a ranked table with
// points columns would read like final results that don't exist yet — in that
// case we render a seeded PARTICIPANTS list (no points columns) instead, and
// only switch to the full standings table once real results land.
function StandingsSection({
  standings,
  running,
  finalSection,
  locale,
  text,
  returnContext,
}: {
  standings: StandingRow[];
  running: MatchRow[];
  finalSection: string | null;
  locale: Locale;
  text: TournamentCopy;
  returnContext: ProfileReturnContext;
}) {
  const sectionRows = new Map<string, Map<string, StandingRow>>();
  for (const row of standings) {
    const key = row.section ?? "";
    const teams = sectionRows.get(key) ?? new Map<string, StandingRow>();
    const teamKey = row.team.trim().toLocaleLowerCase();
    const current = teams.get(teamKey);
    if (!current || standingRowWeight(row) >= standingRowWeight(current)) teams.set(teamKey, row);
    sectionRows.set(key, teams);
  }
  const sections = [...sectionRows.entries()]
    .map(([section, teams], index) => ({
      section,
      rows: [...teams.values()].sort((a, b) => a.rank - b.rank || a.id - b.id),
      value: `standings-${index}`,
      active: running.some((match) => standingsSectionMatches(section, match.name)),
      final: section === finalSection,
      sourceOrder: index,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.final) - Number(a.final) || a.sourceOrder - b.sourceOrder);
  const uniqueStandings = sections.flatMap(({ rows }) => rows);
  const hasResults = uniqueStandings.some(
    (row) => hasNumericResult(row.points) || hasNumericResult(row.extra),
  );
  const hasExtra = hasResults && uniqueStandings.some((row) => row.extra);
  const activeValues = sections
    .filter(({ active, final }) => active || final)
    .map(({ value }) => value);

  return (
    <section className="flex flex-col gap-4" dir={directionForLocale(locale)}>
      <h2 className="text-lg font-semibold">{hasResults ? text.standings : text.participants}</h2>
      <Accordion
        key={activeValues.join("|")}
        dir={directionForLocale(locale)}
        multiple
        defaultValue={activeValues}
        className="rounded-lg border"
      >
        {sections.map(({ section, rows, value, active, final }) => {
          const hasEwcPoints = final && rows.some((row) => row.ewc_points != null);
          return (
            <AccordionItem
              key={value}
              value={value}
              className={final ? "bg-primary/5 px-3 last:border-b-0" : "px-3 last:border-b-0"}
            >
              <AccordionTrigger className="no-underline hover:no-underline">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">
                    {displayStandingsSection(section) || (hasResults ? text.standings : text.participants)}
                  </span>
                  <Badge variant="secondary">{rows.length}</Badge>
                  {active ? <Badge>{text.liveNow}</Badge> : null}
                  {final ? <Badge variant="outline">{text.finalStandings}</Badge> : null}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <Table className="border-t" dir={directionForLocale(locale)}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">{hasResults ? text.rank : text.seed}</TableHead>
                <TableHead>{text.team}</TableHead>
                {hasResults ? <TableHead className="text-end">{text.points}</TableHead> : null}
                {hasExtra ? <TableHead className="text-end">{text.score}</TableHead> : null}
                {hasEwcPoints ? <TableHead className="text-end">{text.ewcPoints}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{row.rank}</TableCell>
                  <TableCell className="text-start">
                    <span
                      className="flex w-full min-w-0 items-center gap-2 text-sm font-medium"
                      dir={directionForLocale(locale)}
                    >
                      <Logo url={row.logo} alt={row.team} />
                      <TeamName
                        label={row.team}
                        teamId={row.team_id}
                        profileId={row.profile_id}
                        profileType={row.profile_type}
                        locale={locale}
                        returnContext={returnContext}
                      />
                    </span>
                  </TableCell>
                  {hasResults ? (
                    <TableCell className="text-end tabular-nums font-semibold">
                      {row.points || "-"}
                    </TableCell>
                  ) : null}
                  {hasExtra ? (
                    <TableCell className="text-end tabular-nums text-muted-foreground">
                      {row.extra || "-"}
                    </TableCell>
                  ) : null}
                  {hasEwcPoints ? (
                    <TableCell className="text-end tabular-nums font-semibold text-primary">
                      {formatNumber(row.ewc_points ?? 0, locale)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </section>
  );
}

function standingRowWeight(row: StandingRow): number {
  const points = Number(row.points);
  const extra = Number(row.extra);
  return (Number.isFinite(points) ? Math.abs(points) : 0) + (Number.isFinite(extra) ? Math.abs(extra) : 0);
}

function normalizedStandingsStage(value: string | null | undefined): string {
  const parts = String(value ?? "").trim().split(/\s*:\s*/).filter(Boolean);
  return (parts.at(-1) ?? "")
    .replace(/\s+-\s+game\s+\d+$/i, "")
    .replace(/\bfinals\b/gi, "Final")
    .trim()
    .toLocaleLowerCase();
}

function displayStandingsSection(value: string): string {
  const parts = value.trim().split(/\s*:\s*/).filter(Boolean);
  const normalized = parts.map((part) => part.replace(/\bfinals\b/gi, "Final").toLocaleLowerCase());
  if (normalized.length > 1 && normalized.every((part) => part === normalized[0])) return parts.at(-1) ?? "";
  return value;
}

function standingsSectionMatches(section: string, matchName: string | null): boolean {
  const sectionStage = normalizedStandingsStage(section);
  const matchStage = normalizedStandingsStage(matchName);
  if (!sectionStage || !matchStage) return false;
  return matchStage === sectionStage || matchStage.startsWith(`${sectionStage} -`);
}
