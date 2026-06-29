"use client";

import { useQuery } from "@tanstack/react-query";
import { RadioIcon } from "lucide-react";
import { Fragment, useState, useSyncExternalStore } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
import { copy, directionForLocale, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
import { safeUrlOrUndefined } from "@/lib/safe-url";

type MatchStatus = "running" | "scheduled" | "finished";
type Winner = "a" | "b" | "draw" | null;
type TournamentCopy = (typeof copy)[Locale]["tournaments"];

type MatchRow = {
  id: number;
  name: string | null;
  team_a: string | null;
  team_b: string | null;
  logo_a: string | null;
  logo_b: string | null;
  score_a: number | null;
  score_b: number | null;
  status: MatchStatus;
  scheduled_at: number | null;
  updated_at: string | null;
  stream?: { platform: string; url: string } | null;
  coStreams?: { platform: string; handle: string; label: string; url: string | null }[];
};

export type TournamentMatchesPayload = {
  tournament: {
    id: number;
    name: string | null;
    game: string | null;
    source: string;
    url: string | null;
  };
  matches: { running: MatchRow[]; scheduled: MatchRow[]; finished: MatchRow[] };
  total: number;
};

// Live data: poll the matches API every 90s. The bot polls at most every 5 min,
// so 90s keeps the page fresh without adding source-site load.
const REFETCH_INTERVAL_MS = 90_000;
const NUMBER_LOCALE: Record<Locale, string> = { en: "en-US", ar: "ar-SA" };

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

function resultWinner(match: MatchRow): Winner {
  if (match.status !== "finished" || match.score_a == null || match.score_b == null) return null;
  if (match.score_a > match.score_b) return "a";
  if (match.score_b > match.score_a) return "b";
  return "draw";
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
  a,
  b,
  winner,
  fallback,
  drawLabel,
}: {
  a: number | null;
  b: number | null;
  winner: Winner;
  fallback: string;
  drawLabel: string;
}) {
  if (a == null || b == null) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums font-semibold">
      <span className={winner === "a" ? "text-primary" : "text-foreground"}>{a}</span>
      <span className="text-muted-foreground">-</span>
      <span className={winner === "b" ? "text-primary" : "text-foreground"}>{b}</span>
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

function MatchText({
  a,
  b,
  logoA,
  logoB,
  locale,
  tbd,
  vs,
  winner,
}: {
  a: string | null;
  b: string | null;
  logoA?: string | null;
  logoB?: string | null;
  locale: Locale;
  tbd: string;
  vs: string;
  winner?: Winner;
}) {
  const aLabel = teamLabel(a, tbd);
  const bLabel = teamLabel(b, tbd);
  return (
    <span dir={directionForLocale(locale)} className="flex max-w-full items-center gap-2 text-start">
      <span className="flex min-w-0 items-center gap-1.5">
        <Logo url={logoA ?? null} alt={aLabel} />
        <bdi className={`min-w-0 truncate ${winner === "a" ? "font-bold text-foreground" : ""}`}>{aLabel}</bdi>
      </span>
      <span className="shrink-0 text-muted-foreground">{vs}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <bdi className={`min-w-0 truncate ${winner === "b" ? "font-bold text-foreground" : ""}`}>{bLabel}</bdi>
        <Logo url={logoB ?? null} alt={bLabel} />
      </span>
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
}: {
  tournamentId: number;
  locale: Locale;
  initialData: TournamentMatchesPayload;
}) {
  const hasHydrated = useHasHydrated();
  const text = copy[locale].tournaments;
  const query = useQuery<TournamentMatchesPayload>({
    queryKey: ["tournament-matches", tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/matches`);
      if (!res.ok) throw new Error("Failed to load matches");
      return res.json();
    },
    initialData,
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const { running, scheduled, finished } = query.data.matches;
  const scheduledGroups = groupMatchesByLocalDay(scheduled, locale, text, hasHydrated);
  const finishedGroups = groupMatchesByLocalDay(finished, locale, text, hasHydrated);
  const tbd = text.tbd;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <RadioIcon className="size-4 text-primary" />
          {text.liveNow}
        </h2>
        {running.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {running.map((m) => (
              <Card key={m.id} size="sm" className="flex flex-col">
                <CardContent className="flex items-center justify-between gap-3 py-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <Logo url={m.logo_a} alt={teamLabel(m.team_a, tbd)} />
                    <span className="truncate text-sm font-medium" dir="auto">
                      {teamLabel(m.team_a, tbd)}
                    </span>
                  </div>
                  <ScoreText a={m.score_a} b={m.score_b} />
                  <div className="flex min-w-0 items-center justify-end gap-2">
                    <span className="truncate text-sm font-medium" dir="auto">
                      {teamLabel(m.team_b, tbd)}
                    </span>
                    <Logo url={m.logo_b} alt={teamLabel(m.team_b, tbd)} />
                  </div>
                </CardContent>
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

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{text.upcoming}</h2>
        {scheduled.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{text.time}</TableHead>
                <TableHead>{text.match}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scheduledGroups.map((group) => (
                <Fragment key={group.key}>
                  <DayHeadingRow label={group.label} columns={2} />
                  {group.matches.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground tabular-nums">
                        <MatchTime value={m.scheduled_at} locale={locale} fallback={text.timeTbd} />
                      </TableCell>
                      <TableCell className="text-start">
                        <MatchText
                          a={m.team_a}
                          b={m.team_b}
                          logoA={m.logo_a}
                          logoB={m.logo_b}
                          locale={locale}
                          tbd={tbd}
                          vs={text.vs}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{text.results}</h2>
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
                    const winner = resultWinner(m);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-muted-foreground tabular-nums">
                          <MatchTime value={m.scheduled_at} locale={locale} fallback={text.timeTbd} />
                        </TableCell>
                        <TableCell className="text-start">
                          <MatchText
                            a={m.team_a}
                            b={m.team_b}
                            logoA={m.logo_a}
                            logoB={m.logo_b}
                            locale={locale}
                            tbd={tbd}
                            vs={text.vs}
                            winner={winner}
                          />
                        </TableCell>
                        <TableCell className="text-end">
                          <ResultScoreText
                            a={m.score_a}
                            b={m.score_b}
                            winner={winner}
                            fallback={text.finished}
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

      {query.data.total === 0 ? (
        <p className="text-sm text-muted-foreground">{text.noMatches}</p>
      ) : null}
    </div>
  );
}
