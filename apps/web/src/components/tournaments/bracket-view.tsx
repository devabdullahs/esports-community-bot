"use client";

import { TrophyIcon } from "lucide-react";
import { useState } from "react";
import { BracketMatchCard } from "@/components/tournaments/bracket-match-card";
import {
  buildBracketLayout,
  defaultSectionKey,
  type LayoutRound,
  type LayoutSection,
} from "@/lib/bracket-layout";
import type { TournamentBracket } from "@/lib/tournament-brackets";
import { copy, directionForLocale, type Locale } from "@/lib/i18n";
import { drawFromLabelProjection, type TournamentDraw } from "@/lib/tournament-draw";

type TournamentCopy = (typeof copy)[Locale]["tournaments"];

function phaseLabel(round: LayoutRound, text: TournamentCopy): string {
  const phase = round.phase;
  const fallback = round.title ?? "";
  if (!phase) return fallback;
  switch (phase.kind) {
    case "round-of":
      return phase.roundOf != null ? text.bracketRoundOf(phase.roundOf) : fallback;
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
      return phase.number != null ? text.bracketRound(phase.number) : fallback;
    default:
      return fallback;
  }
}

/**
 * A drawn round is titled by the heading above it, but a workbook does not always give one —
 * the grand final is written as a slot ("Grand Final") under no heading at all, and the round
 * then falls back to the parser's generic "Bracket". Where every slot in the round agrees on
 * a name, that name IS the round.
 */
function drawnRoundTitle(round: LayoutRound): string {
  const title = round.title?.trim() ?? "";
  if (title && !/^bracket$/i.test(title)) return title;
  const labels = round.cells.map((cell) => cell.slot.label?.trim() ?? "");
  const shared = labels[0];
  return shared && labels.every((label) => label === shared) ? shared : title;
}

function roundLabel(round: LayoutRound, text: TournamentCopy, showBandHeadings: boolean): string {
  // A drawn round already carries the name the workbook gave it ("UB Ro4"), which is more
  // specific than anything derived from a branch; only a label-projected round needs the
  // branch spelled out, and only when the band above it does not already say so.
  if (!round.phase) return drawnRoundTitle(round);
  const phase = phaseLabel(round, text);
  if (showBandHeadings || !round.branch) return phase;
  const branch = round.branch === "upper" ? text.bracketUpper : text.bracketLower;
  return phase && phase !== round.title ? `${branch} - ${phase}` : branch;
}

/**
 * The bracket, drawn from whichever source knows its shape.
 *
 * The official workbooks are read as a real draw — sections, rounds, slots, and feeder edges
 * taken from cell text — while a label-projected bracket knows only which round a match
 * belongs to. Both are adapted into one model before they get here, so this component has a
 * single rendering path and the difference shows up as edges being present or absent.
 */
export function BracketView({
  bracket,
  draw,
  locale,
}: {
  bracket: TournamentBracket;
  draw?: TournamentDraw | null;
  locale: Locale;
}) {
  const text = copy[locale].tournaments;
  const headingId = "tournament-bracket-heading";
  const model = draw ?? drawFromLabelProjection(bracket);
  const layout = buildBracketLayout(model);
  // A tournament draws several sections — groups, play-ins, playoffs — and stacking them all
  // makes the page a wall of cards where the one being played is somewhere in the middle.
  // Show one at a time and open on the one that is live, so the default view answers "what is
  // happening now" rather than "what happened first".
  const [section, setSection] = useState<string | null>(() => defaultSectionKey(layout));
  const shown = layout.sections.find((entry) => entry.key === section) ?? layout.sections[0];
  const tabbed = layout.sections.length > 1;

  return (
    <section
      data-bracket-view="true"
      data-bracket-source={layout.source}
      aria-labelledby={headingId}
      dir={directionForLocale(locale)}
      className="flex flex-col gap-3"
    >
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        <TrophyIcon className="size-4 text-primary" aria-hidden="true" />
        {text.bracket}
      </h2>
      {tabbed ? (
        <div
          role="tablist"
          aria-label={text.bracket}
          data-bracket-sections={layout.sections.length}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {layout.sections.map((entry) => {
            const current = entry.key === shown?.key;
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                id={`bracket-tab-${entry.key}`}
                aria-selected={current}
                aria-controls={`bracket-panel-${entry.key}`}
                onClick={() => setSection(entry.key)}
                className={[
                  "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  current
                    ? "border-primary bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {entry.title ?? text.bracket}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        data-bracket-scroll="true"
        aria-label={text.bracketScrollLabel}
        tabIndex={0}
        className="overflow-x-auto overscroll-x-contain pb-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex min-w-max flex-col gap-8 lg:min-w-full">
          {shown ? (
            <BracketSection
              key={shown.key}
              section={shown}
              showSectionHeading={false}
              locale={locale}
              text={text}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function BracketSection({
  section,
  showSectionHeading,
  locale,
  text,
}: {
  section: LayoutSection;
  showSectionHeading: boolean;
  locale: Locale;
  text: TournamentCopy;
}) {
  // With one branch there is nothing to separate, so the band heading would only repeat the
  // section title above it.
  const showBandHeadings = section.bands.filter((band) => band.branch).length > 1;

  return (
    <div
      data-bracket-section={section.key}
      id={`bracket-panel-${section.key}`}
      role="tabpanel"
      aria-labelledby={`bracket-tab-${section.key}`}
      className="flex flex-col gap-3"
    >
      {showSectionHeading && section.title ? (
        <h3 className="text-sm font-semibold">{section.title}</h3>
      ) : null}
      {section.bands.map((band) => (
        <div
          key={band.branch ?? "open"}
          data-bracket-branch={band.branch ?? "open"}
          className="flex flex-col gap-2"
        >
          {showBandHeadings && band.branch ? (
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {band.branch === "upper" ? text.bracketUpper : text.bracketLower}
            </h4>
          ) : null}
          {/*
            One grid per band, with the round headings occupying its first row and every slot
            placed on an explicit row and span. Declaring the placement rather than letting
            flex distribute it is what lets a connector be a percentage-positioned elbow on
            the receiving cell: with the feeders on that cell's two halves, their centres are
            at fixed fractions of it, and nothing has to be measured on resize, zoom, font
            swap, RTL, or scroll.
          */}
          <div
            data-bracket-columns={section.columns}
            className="grid snap-x snap-mandatory justify-start gap-x-(--bracket-gutter) gap-y-2 md:snap-none"
            style={{
              // One round fills a phone screen; on a desktop the rounds share the width but
              // stop growing, so a section with a single drawn round does not stretch one
              // card across the whole page.
              gridTemplateColumns: `repeat(${section.columns}, minmax(min(72vw, 15rem), 19rem))`,
              gridTemplateRows: `auto repeat(${band.tracks}, minmax(var(--bracket-track), auto))`,
            }}
          >
            {band.rounds.map((round) => (
              <h5
                key={`${round.key}-heading`}
                data-bracket-round={round.key}
                className="snap-start self-end truncate border-b px-1.5 pb-2 text-sm font-semibold"
                style={{ gridColumn: round.column, gridRow: 1 }}
              >
                {roundLabel(round, text, showBandHeadings)}
                {round.bestOf ? (
                  <span className="ms-1.5 font-normal text-muted-foreground">{text.bracketBestOf(round.bestOf)}</span>
                ) : null}
              </h5>
            ))}
            {band.rounds.flatMap((round) =>
              round.cells.map((cell) => (
                <div
                  key={cell.slot.key}
                  data-bracket-cell="true"
                  data-connector={cell.connector ? "pair" : undefined}
                  data-feeds={cell.feedsConnector ? "pair" : undefined}
                  className="relative flex items-center px-0.5"
                  style={{ gridColumn: round.column, gridRow: `${cell.row + 1} / span ${cell.span}` }}
                >
                  <BracketMatchCard
                    cell={cell}
                    locale={locale}
                    text={text}
                    roundTitle={roundLabel(round, text, showBandHeadings)}
                  />
                </div>
              )),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
