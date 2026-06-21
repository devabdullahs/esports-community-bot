"use client";

import { useQuery } from "@tanstack/react-query";
import { RadioIcon } from "lucide-react";
import { useState } from "react";
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
  stream?: { platform: string; channel: string; url: string } | null;
  coStreams?: { platform: string; handle: string; label: string; url: string | null }[];
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
  if (a == null || b == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums font-semibold">
      {a} <span className="text-muted-foreground">–</span> {b}
    </span>
  );
}

function ResultScoreText({ a, b, fallback }: { a: number | null; b: number | null; fallback: string }) {
  if (a == null || b == null) return <span className="text-muted-foreground">{fallback}</span>;
  return <ScoreText a={a} b={b} />;
}

function MatchTime({ value, locale }: { value: number | null; locale: Locale }) {
  if (value == null || !Number.isFinite(value)) return <span>—</span>;
  return <LocalDateTime value={new Date(value * 1000).toISOString()} locale={locale} />;
}

function MatchText({
  a,
  b,
  locale,
  tbd,
  vs,
}: {
  a: string | null;
  b: string | null;
  locale: Locale;
  tbd: string;
  vs: string;
}) {
  return (
    <span dir={directionForLocale(locale)} className="flex max-w-full items-center gap-1.5 text-start">
      <bdi className="min-w-0 truncate">{teamLabel(a, tbd)}</bdi>
      <span className="shrink-0 text-muted-foreground">{vs}</span>
      <bdi className="min-w-0 truncate">{teamLabel(b, tbd)}</bdi>
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
                    title={`${m.stream.channel} · ${m.stream.platform}`}
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
                        title={`${c.label} · ${c.platform}`}
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
                    <MatchTime value={m.scheduled_at} locale={locale} />
                  </TableCell>
                  <TableCell className="text-start">
                    <MatchText a={m.team_a} b={m.team_b} locale={locale} tbd={tbd} vs={text.vs} />
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
                    <MatchTime value={m.scheduled_at} locale={locale} />
                  </TableCell>
                  <TableCell className="text-start">
                    <MatchText a={m.team_a} b={m.team_b} locale={locale} tbd={tbd} vs={text.vs} />
                  </TableCell>
                  <TableCell className="text-end">
                    <ResultScoreText a={m.score_a} b={m.score_b} fallback={text.finished} />
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
