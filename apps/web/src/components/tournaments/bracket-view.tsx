"use client";

import { TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { BracketRound, TournamentBracket } from "@/lib/tournament-brackets";
import { copy, directionForLocale, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
import { safeUrlOrUndefined } from "@/lib/safe-url";

type TournamentCopy = (typeof copy)[Locale]["tournaments"];

function teamLabel(value: string | null, fallback: string) {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function TeamLogo({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const safe = safeUrlOrUndefined(url);
  if (!safe || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[0.55rem] font-semibold uppercase text-muted-foreground"
      >
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
      className="size-5 shrink-0 rounded object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function phaseLabel(round: BracketRound, text: TournamentCopy): string {
  switch (round.kind) {
    case "round-of":
      return round.roundOf != null ? text.bracketRoundOf(round.roundOf) : round.label;
    case "quarterfinal":
      return text.bracketQuarterfinals;
    case "semifinal":
      return text.bracketSemifinals;
    case "final":
      return text.bracketFinal;
    case "grand-final":
      return text.bracketGrandFinal;
    case "third-place":
      return text.bracketThirdPlace;
    case "numeric":
      return round.number != null ? text.bracketRound(round.number) : round.label;
    default:
      return round.label;
  }
}

function roundLabel(round: BracketRound, text: TournamentCopy): string {
  if (!round.branch) return phaseLabel(round, text);
  const branch = round.branch === "upper" ? text.bracketUpper : text.bracketLower;
  const phase = phaseLabel(round, text);
  return phase === round.label ? branch : `${branch} - ${phase}`;
}

function Score({ value, winner, locale }: { value: number | null; winner: boolean; locale: Locale }) {
  return (
    <span className={winner ? "font-bold text-primary tabular-nums" : "tabular-nums text-muted-foreground"}>
      {value == null ? "-" : formatNumber(value, locale)}
    </span>
  );
}

function BracketMatchCard({
  match,
  locale,
  text,
}: {
  match: BracketRound["matches"][number];
  locale: Locale;
  text: TournamentCopy;
}) {
  const teamA = teamLabel(match.team_a, text.tbd);
  const teamB = teamLabel(match.team_b, text.tbd);
  const href = match.has_details
    ? localizedPath(`/matches/${match.id}`, locale)
    : `#tournament-match-${match.id}`;
  const winnerA = match.winner === "a";
  const winnerB = match.winner === "b";

  return (
    <Link
      href={href}
      data-bracket-match={match.id}
      className="group flex min-h-20 flex-col justify-center gap-1.5 rounded-lg border bg-card px-2.5 py-2 text-sm shadow-xs transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label={`${teamA} ${text.vs} ${teamB}`}
    >
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <TeamLogo url={match.logo_a} alt={teamA} />
          <bdi className={winnerA ? "truncate font-bold" : "truncate"}>{teamA}</bdi>
        </span>
        <Score value={match.score_a} winner={winnerA} locale={locale} />
      </span>
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <TeamLogo url={match.logo_b} alt={teamB} />
          <bdi className={winnerB ? "truncate font-bold" : "truncate"}>{teamB}</bdi>
        </span>
        <Score value={match.score_b} winner={winnerB} locale={locale} />
      </span>
    </Link>
  );
}

export function BracketView({ bracket, locale }: { bracket: TournamentBracket; locale: Locale }) {
  const text = copy[locale].tournaments;
  const headingId = "tournament-bracket-heading";

  return (
    <section data-bracket-view="true" aria-labelledby={headingId} dir={directionForLocale(locale)} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        <TrophyIcon className="size-4 text-primary" aria-hidden="true" />
        {text.bracket}
      </h2>
      <div
        data-bracket-scroll="true"
        aria-label={text.bracketScrollLabel}
        tabIndex={0}
        className="overflow-x-auto overscroll-x-contain pb-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div
          data-bracket-columns={bracket.rounds.length}
          className="grid min-w-max grid-flow-col auto-cols-[13rem] gap-3 snap-x snap-mandatory lg:min-w-full lg:grid-flow-row lg:auto-cols-auto"
          style={{ gridTemplateColumns: `repeat(${bracket.rounds.length}, minmax(13rem, 1fr))` }}
        >
          {bracket.rounds.map((round) => (
            <section key={round.key} data-bracket-round={round.key} className="min-w-[13rem] snap-start">
              <h3 className="sticky top-0 z-10 mb-2 border-b bg-background/95 px-1.5 py-2 text-sm font-semibold backdrop-blur">
                {roundLabel(round, text)}
              </h3>
              <div className="flex flex-col gap-2">
                {round.matches.map((match) => (
                  <BracketMatchCard key={match.id} match={match} locale={locale} text={text} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
