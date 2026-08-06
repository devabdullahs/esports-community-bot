"use client";

import { TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { BracketRound, TournamentBracket } from "@/lib/tournament-brackets";
import { copy, directionForLocale, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
import { matchOutcomeLabel, shouldShowOutcomeLabel } from "@/lib/match-lifecycle";
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
  const href = localizedPath(`/matches/${match.id}`, locale);
  const winnerA = match.winner === "a";
  const winnerB = match.winner === "b";
  const lifecycleLabel = shouldShowOutcomeLabel(match)
    ? matchOutcomeLabel(match, locale)
    : null;

  return (
    <Link
      href={href}
      data-bracket-match={match.id}
      className="group flex min-h-20 w-full flex-col justify-center gap-1.5 rounded-lg border bg-card px-2.5 py-2 text-sm shadow-xs transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
      {lifecycleLabel ? (
        <span className="pt-0.5">
          <Badge
            variant={match.status === "postponed" ? "secondary" : "outline"}
            className="max-w-full truncate"
          >
            {lifecycleLabel}
          </Badge>
        </span>
      ) : null}
    </Link>
  );
}

// A double-elimination draw is two brackets, not one row of rounds. Laying every round out
// side by side puts "Lower Bracket Round 1" after the upper final, so a team's fall reads as
// a jump along the same line. Stack the branches instead, the way a drawn bracket does, and
// let the round columns line up between them.
const BRANCH_BANDS = ["upper", "lower", null] as const;

function bandRounds(rounds: BracketRound[], branch: BracketRound["branch"]) {
  return rounds.filter((round) => round.branch === branch);
}

export function BracketView({ bracket, locale }: { bracket: TournamentBracket; locale: Locale }) {
  const text = copy[locale].tournaments;
  const headingId = "tournament-bracket-heading";
  const bands = BRANCH_BANDS.map((branch) => ({ branch, rounds: bandRounds(bracket.rounds, branch) })).filter(
    (band) => band.rounds.length,
  );
  // With one branch there is nothing to separate, so the band heading would only repeat the
  // section title above it.
  const showBandHeadings = bands.filter((band) => band.branch).length > 1;
  const widest = Math.max(...bands.map((band) => band.rounds.length), 1);

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
        <div className="flex min-w-max flex-col gap-6 lg:min-w-full">
          {bands.map((band) => (
            <div key={band.branch ?? "open"} data-bracket-branch={band.branch ?? "open"} className="flex flex-col gap-2">
              {showBandHeadings && band.branch ? (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {band.branch === "upper" ? text.bracketUpper : text.bracketLower}
                </h3>
              ) : null}
              <div
                data-bracket-columns={band.rounds.length}
                className="grid gap-3 snap-x snap-mandatory"
                style={{ gridTemplateColumns: `repeat(${widest}, minmax(13rem, 1fr))` }}
              >
                {band.rounds.map((round) => (
                  <section key={round.key} data-bracket-round={round.key} className="flex min-w-[13rem] flex-col snap-start">
                    <h4 className="sticky top-0 z-10 mb-2 border-b bg-background/95 px-1.5 py-2 text-sm font-semibold backdrop-blur">
                      {showBandHeadings && band.branch ? phaseLabel(round, text) : roundLabel(round, text)}
                    </h4>
                    {/*
                      A round is as tall as the widest one beside it, and each match takes an
                      equal share of that height. A round with half as many matches therefore
                      centres each one against the pair that feeds it, which is what makes the
                      columns read as one bracket rather than three separate lists — and it
                      needs no measured connector geometry to do it.
                    */}
                    <div className="flex flex-1 flex-col gap-2">
                      {round.matches.map((match) => (
                        <div key={match.id} className="flex flex-1 items-center">
                          <BracketMatchCard match={match} locale={locale} text={text} />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
