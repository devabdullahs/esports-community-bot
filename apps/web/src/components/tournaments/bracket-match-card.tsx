"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { LayoutCell } from "@/lib/bracket-layout";
import { copy, formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
import {
  matchOutcomeLabel,
  matchStatusLabel,
  shouldShowOutcomeLabel,
  type MatchLifecycleView,
} from "@/lib/match-lifecycle";
import type { DrawAwaiting, DrawSlot } from "@/lib/tournament-draw";
import { safeUrlOrUndefined } from "@/lib/safe-url";

type TournamentCopy = (typeof copy)[Locale]["tournaments"];

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

function Score({ value, winner, locale }: { value: number | null; winner: boolean; locale: Locale }) {
  return (
    <span
      className={[
        "w-(--bracket-score-w) shrink-0 text-end tabular-nums",
        winner ? "font-bold text-primary" : "text-muted-foreground",
      ].join(" ")}
    >
      {value == null ? "-" : formatNumber(value, locale)}
    </span>
  );
}

/** What a side reads as before it has a competitor: the feeder it waits on, or plain TBD. */
function awaitingLabel(awaiting: DrawAwaiting | null, text: TournamentCopy): string | null {
  if (!awaiting) return null;
  return awaiting.outcome === "winner"
    ? text.bracketAwaitingWinner(awaiting.slot)
    : text.bracketAwaitingLoser(awaiting.slot);
}

function sideLabel(name: string | null, awaiting: DrawAwaiting | null, text: TournamentCopy): string {
  return name?.trim() || awaitingLabel(awaiting, text) || text.tbd;
}

function TeamRow({
  name,
  awaiting,
  logo,
  score,
  winner,
  locale,
  text,
}: {
  name: string | null;
  awaiting: DrawAwaiting | null;
  logo: string | null;
  score: number | null;
  winner: boolean;
  locale: Locale;
  text: TournamentCopy;
}) {
  const label = sideLabel(name, awaiting, text);
  const undrawn = !name?.trim();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {undrawn ? null : <TeamLogo url={logo} alt={label} />}
        <bdi
          className={[
            "truncate",
            winner ? "font-bold" : "",
            undrawn ? "text-muted-foreground italic" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {label}
        </bdi>
      </span>
      <Score value={score} winner={winner} locale={locale} />
    </span>
  );
}

/**
 * One slot in the draw. It is a link only when the slot joined a stored match row — an
 * undrawn slot has no page to go to, and a card that looks clickable but is not reads as a
 * broken site rather than as an empty fixture.
 */
export function BracketMatchCard({
  cell,
  locale,
  text,
  followed,
  roundTitle,
}: {
  cell: LayoutCell;
  locale: Locale;
  text: TournamentCopy;
  followed: string | null;
  roundTitle: string | null;
}) {
  const slot: DrawSlot = cell.slot;
  const teamA = sideLabel(slot.teamA, slot.awaitingA, text);
  const teamB = sideLabel(slot.teamB, slot.awaitingB, text);
  const winnerA = slot.winner === "a";
  const winnerB = slot.winner === "b";
  const live = slot.status === "running";
  const lifecycleView: MatchLifecycleView = {
    status: slot.status,
    team_a: slot.teamA,
    team_b: slot.teamB,
    score_a: slot.scoreA,
    score_b: slot.scoreB,
    winner_side: slot.winner === "a" ? "team1" : slot.winner === "b" ? "team2" : null,
    result_reason: slot.resultReason,
  };
  const lifecycle = shouldShowOutcomeLabel(lifecycleView) ? matchOutcomeLabel(lifecycleView, locale) : null;

  const onPath =
    followed != null &&
    ((slot.teamA ?? "").trim().toLocaleLowerCase() === followed ||
      (slot.teamB ?? "").trim().toLocaleLowerCase() === followed);
  const offPath = followed != null && !onPath;

  const className = [
    "group flex min-h-20 w-full flex-col justify-center gap-1.5 rounded-lg border bg-card px-2.5 py-2 text-sm shadow-xs transition-[opacity,border-color,background-color] motion-reduce:transition-none",
    // A run is shown by lifting it out of its surroundings rather than by recolouring it, so
    // the winner emphasis inside the card keeps its meaning.
    onPath ? "border-primary bg-muted/30" : "",
    offPath ? "opacity-45" : "",
    // Live and finished are marked by a shape change on the leading edge, never by colour
    // alone: the same reading has to survive a monochrome screen.
    live ? "border-s-2 border-s-primary" : "",
    slot.matchId != null
      ? "hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      : "border-dashed",
  ]
    .filter(Boolean)
    .join(" ");

  const label = [roundTitle, `${teamA} ${text.vs} ${teamB}`, live ? matchStatusLabel("running", locale) : null]
    .filter(Boolean)
    .join(" — ");

  const body = (
    <>
      {live ? (
        <span className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-primary">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse"
          />
          {matchStatusLabel("running", locale)}
        </span>
      ) : null}
      <TeamRow
        name={slot.teamA}
        awaiting={slot.awaitingA}
        logo={slot.logoA}
        score={slot.scoreA}
        winner={winnerA}
        locale={locale}
        text={text}
      />
      <TeamRow
        name={slot.teamB}
        awaiting={slot.awaitingB}
        logo={slot.logoB}
        score={slot.scoreB}
        winner={winnerB}
        locale={locale}
        text={text}
      />
      {lifecycle ? (
        <span className="pt-0.5">
          <Badge
            variant={slot.status === "postponed" ? "secondary" : "outline"}
            className="max-w-full truncate"
          >
            {lifecycle}
          </Badge>
        </span>
      ) : null}
    </>
  );

  const shared = {
    "data-bracket-match": slot.matchId ?? undefined,
    "data-bracket-slot": slot.key,
    "data-bracket-path": onPath ? ("true" as const) : undefined,
    "data-state": live ? "live" : slot.status === "finished" ? "final" : slot.status,
    "data-winner": slot.winner === "a" || slot.winner === "b" ? slot.winner : undefined,
    className,
  };

  if (slot.matchId == null) {
    return (
      <div {...shared} aria-label={label} role="group">
        {body}
      </div>
    );
  }
  return (
    <Link {...shared} href={localizedPath(`/matches/${slot.matchId}`, locale)} aria-label={label}>
      {body}
    </Link>
  );
}
