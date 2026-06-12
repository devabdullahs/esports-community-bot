"use client";

import { useQuery } from "@tanstack/react-query";
import { RadioIcon } from "lucide-react";
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
import { copy, formatUnixSeconds, type Locale } from "@/lib/i18n";
import { safeUrlOrUndefined } from "@/lib/safe-url";

type MatchStatus = "running" | "scheduled" | "finished";

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
};

export type TournamentMatchesPayload = {
  tournament: { id: number; name: string | null; game: string | null; source: string; url: string | null };
  matches: { running: MatchRow[]; scheduled: MatchRow[]; finished: MatchRow[] };
  total: number;
};

// Live data: poll the matches API every 90s (design recommendation — the bot
// polls at most every 5 min, so 90s keeps the view fresh without wasted load).
const REFETCH_INTERVAL_MS = 90_000;

function teamLabel(value: string | null, fallback: string) {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function Logo({ url, alt }: { url: string | null; alt: string }) {
  const safe = safeUrlOrUndefined(url);
  if (!safe) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-[0.6rem] font-semibold uppercase text-muted-foreground">
        {alt.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={safe} alt="" loading="lazy" className="size-6 shrink-0 rounded object-contain" />
  );
}

function ScoreText({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums font-semibold">
      {a} <span className="text-muted-foreground">–</span> {b}
    </span>
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
  const tbd = text.tbd;

  return (
    <div className="flex flex-col gap-8">
      {/* Live now */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <RadioIcon className="size-4 text-primary" />
          {text.liveNow}
        </h2>
        {running.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {running.map((m) => (
              <Card key={m.id} size="sm">
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
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{text.noLive}</p>
        )}
      </section>

      <Separator />

      {/* Upcoming */}
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
              {scheduled.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatUnixSeconds(m.scheduled_at, locale) || "—"}
                  </TableCell>
                  <TableCell dir="auto">
                    {teamLabel(m.team_a, tbd)} <span className="text-muted-foreground">{text.vs}</span>{" "}
                    {teamLabel(m.team_b, tbd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{text.noUpcoming}</p>
        )}
      </section>

      <Separator />

      {/* Recent results */}
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
              {finished.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatUnixSeconds(m.scheduled_at, locale) || "—"}
                  </TableCell>
                  <TableCell dir="auto">
                    {teamLabel(m.team_a, tbd)} <span className="text-muted-foreground">{text.vs}</span>{" "}
                    {teamLabel(m.team_b, tbd)}
                  </TableCell>
                  <TableCell className="text-end">
                    <ScoreText a={m.score_a} b={m.score_b} />
                  </TableCell>
                </TableRow>
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
