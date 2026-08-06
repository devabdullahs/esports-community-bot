import type { DrawBranch, DrawRound, DrawSection, DrawSlot, TournamentDraw } from "@/lib/tournament-draw";

/**
 * Where every slot sits, decided here rather than distributed by the browser.
 *
 * The view used to give each round `flex-1` per match, which centres a round against the pair
 * feeding it without measuring anything — visually right, but nothing about it can be
 * asserted from `renderToStaticMarkup`. Declaring an integer `(row, span)` per cell gives the
 * same picture and makes it testable, and it is what lets a connector be a CSS elbow on the
 * receiving cell instead of a measured overlay: with the feeders occupying exactly the two
 * halves of the cell, their centres are at 25% and 75% of it, in percentages that survive
 * resize, font swap, zoom, RTL, and scroll without a single recomputation.
 */

export type LayoutCell = {
  slot: DrawSlot;
  row: number;
  span: number;
  /** Draw the elbow into this cell: two real edges arrive here and they align to its halves. */
  connector: boolean;
  /** Draw the stub out of this cell, because it feeds a cell whose elbow is drawn. */
  feedsConnector: boolean;
};

export type LayoutRound = {
  key: string;
  /** 1-based grid column within the section. */
  column: number;
  title: string | null;
  branch: DrawBranch;
  bestOf: number | null;
  phase: DrawRound["phase"];
  cells: LayoutCell[];
};

export type LayoutBand = {
  branch: DrawBranch;
  /** Row count the band's cells divide between them. */
  tracks: number;
  rounds: LayoutRound[];
};

export type LayoutSection = {
  key: string;
  title: string | null;
  columns: number;
  bands: LayoutBand[];
};

export type BracketLayout = {
  sections: LayoutSection[];
  source: TournamentDraw["source"];
};

type Placement = { column: number; row: number; span: number };

export function buildBracketLayout(draw: TournamentDraw): BracketLayout {
  return {
    source: draw.source,
    sections: draw.sections.map((section) => layoutSection(section, draw.source)),
  };
}

function layoutSection(section: DrawSection, source: TournamentDraw["source"]): LayoutSection {
  const columnOf = source === "sheet" ? sheetColumns(section.rounds) : timelineColumns(section.rounds);
  const bands = groupIntoBands(section.rounds);
  const placements = new Map<string, Placement>();

  const laidOut: LayoutBand[] = bands.map(({ branch, rounds }) => {
    const tracks = Math.max(...rounds.map((round) => round.slots.length), 1);
    return {
      branch,
      tracks,
      rounds: rounds.map((round) => {
        const column = columnOf(round);
        const cells = round.slots.map((slot, index) => {
          const { row, span } = trackSpan(index, round.slots.length, tracks);
          placements.set(slot.key, { column, row, span });
          return { slot, row, span, connector: false, feedsConnector: false };
        });
        return {
          key: round.key,
          column,
          title: round.title,
          branch: round.branch,
          bestOf: round.bestOf,
          phase: round.phase,
          cells,
        };
      }),
    };
  });

  markConnectors(laidOut, section, placements);

  const columns = Math.max(
    ...laidOut.flatMap((band) => band.rounds.map((round) => round.column)),
    1,
  );
  return { key: section.key, title: section.title, columns, bands: laidOut };
}

/**
 * The sheet author already drew the upper and lower rounds so that concurrent ones line up,
 * so the column is read off the workbook rather than invented.
 */
function sheetColumns(rounds: readonly DrawRound[]): (round: DrawRound) => number {
  const tracks = [...new Set(rounds.map((round) => round.column))].sort((a, b) => a - b);
  return (round) => tracks.indexOf(round.column) + 1;
}

/**
 * Fallback mode has no drawn geometry, only round order. The first lower round is fed by the
 * first upper round, so it cannot be concurrent with it — hence the offset of one. This is a
 * drawing convention rather than a fact in the data, which is why fallback mode draws no
 * connectors: reading one column early is survivable, asserting a pairing is not.
 */
function timelineColumns(rounds: readonly DrawRound[]): (round: DrawRound) => number {
  const upper = rounds.filter((round) => round.branch === "upper");
  const lower = rounds.filter((round) => round.branch === "lower");
  const open = rounds.filter((round) => round.branch == null);
  const branched = upper.length > 0 && lower.length > 0;
  const openStart = branched ? Math.max(upper.length, lower.length + 1) + 1 : 0;

  const columns = new Map<string, number>();
  upper.forEach((round, index) => columns.set(round.key, index + 1));
  lower.forEach((round, index) => columns.set(round.key, branched ? index + 2 : index + 1));
  open.forEach((round, index) =>
    columns.set(round.key, branched ? openStart + index : upper.length + lower.length + index + 1),
  );
  return (round) => columns.get(round.key) ?? 1;
}

/**
 * A double-elimination draw is two brackets. Laid out as one row of rounds, a team's fall
 * reads as a jump along the same line. The grand final and third-place match belong to
 * neither branch and converge at the right of the upper band rather than forming a band of
 * their own, which was the weakest part of the first stacked layout.
 */
function groupIntoBands(rounds: readonly DrawRound[]): Array<{ branch: DrawBranch; rounds: DrawRound[] }> {
  const upper = rounds.filter((round) => round.branch === "upper");
  const lower = rounds.filter((round) => round.branch === "lower");
  if (!upper.length || !lower.length) return [{ branch: null, rounds: [...rounds] }];
  const open = rounds.filter((round) => round.branch == null);
  return [
    { branch: "upper" as const, rounds: [...upper, ...open] },
    { branch: "lower" as const, rounds: lower },
  ];
}

/**
 * Gapless, non-overlapping, and exact for the halving a real bracket produces: four matches
 * over four tracks give spans of 1, two matches give spans of 2, and the semifinal cell
 * covers exactly the two quarterfinal rows beside it.
 */
export function trackSpan(index: number, count: number, tracks: number): { row: number; span: number } {
  if (count <= 0) return { row: 1, span: tracks };
  const start = Math.floor((index * tracks) / count);
  const end = Math.floor(((index + 1) * tracks) / count);
  return { row: start + 1, span: Math.max(end - start, 1) };
}

/**
 * A connector is drawn only where a real edge says the pairing exists AND the geometry the
 * elbow assumes actually holds. Both halves matter: the edges keep the line honest, the
 * geometry check keeps it from pointing at the wrong rows.
 */
function markConnectors(
  bands: readonly LayoutBand[],
  section: DrawSection,
  placements: ReadonlyMap<string, Placement>,
): void {
  if (!section.edges.length) return;

  const incoming = new Map<string, string[]>();
  for (const edge of section.edges) {
    const bucket = incoming.get(edge.to);
    if (bucket) bucket.push(edge.from);
    else incoming.set(edge.to, [edge.from]);
  }

  const cellsByKey = new Map<string, LayoutCell>();
  const bandOfSlot = new Map<string, LayoutBand>();
  for (const band of bands) {
    for (const round of band.rounds) {
      for (const cell of round.cells) {
        cellsByKey.set(cell.slot.key, cell);
        bandOfSlot.set(cell.slot.key, band);
      }
    }
  }

  for (const [to, from] of incoming) {
    if (from.length !== 2) continue;
    const target = placements.get(to);
    const sources = from.map((key) => placements.get(key));
    if (!target || sources.some((placement) => !placement)) continue;
    const placed = sources as Placement[];
    // Cross-band drops are told by chips rather than by a line across the gap, the way
    // Liquipedia and the fandom wikis tell them.
    if (new Set(from.map((key) => bandOfSlot.get(key))).size !== 1) continue;
    if (bandOfSlot.get(to) !== bandOfSlot.get(from[0])) continue;
    if (placed.some((placement) => placement.column !== target.column - 1)) continue;
    if (target.span % 2 !== 0) continue;

    const half = target.span / 2;
    const expected = [
      { row: target.row, span: half },
      { row: target.row + half, span: half },
    ];
    const actual = [...placed].sort((a, b) => a.row - b.row);
    const aligned = expected.every(
      (want, index) => actual[index].row === want.row && actual[index].span === want.span,
    );
    if (!aligned) continue;

    const targetCell = cellsByKey.get(to);
    if (!targetCell) continue;
    targetCell.connector = true;
    for (const key of from) {
      const cell = cellsByKey.get(key);
      if (cell) cell.feedsConnector = true;
    }
  }
}

/**
 * The section to open on, which is the one worth looking at right now: whichever is playing,
 * else whichever finished a match most recently, else the first drawn. A tournament with four
 * groups should not open on Group A for three days after Group A is over.
 */
export function defaultSectionKey(layout: BracketLayout): string | null {
  const slots = layout.sections.flatMap((section, sectionIndex) =>
    section.bands.flatMap((band) =>
      band.rounds.flatMap((round) =>
        round.cells.map((cell, cellIndex) => ({
          key: section.key,
          status: cell.slot.status,
          // No timestamp reaches the draw, so "most recent" is read off the draw's own order:
          // a later column is a later match, and a later section was drawn after an earlier one.
          rank: sectionIndex * 1_000_000 + round.column * 1_000 + cellIndex,
        })),
      ),
    ),
  );

  const live = slots.find((slot) => slot.status === "running");
  if (live) return live.key;
  const decided = slots.filter((slot) => slot.status === "finished");
  const latest = decided.length
    ? decided.reduce((best, slot) => (slot.rank > best.rank ? slot : best))
    : null;
  return latest?.key ?? layout.sections[0]?.key ?? null;
}

/** Every distinct competitor in the draw, first-appearance order, for the follow control. */
export function drawCompetitors(draw: TournamentDraw): Array<{ key: string; label: string }> {
  const teams: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const section of draw.sections) {
    for (const round of section.rounds) {
      for (const slot of round.slots) {
        for (const name of [slot.teamA, slot.teamB]) {
          const label = (name ?? "").trim();
          const key = label.toLocaleLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          teams.push({ key, label });
        }
      }
    }
  }
  return teams;
}

export type { DrawSlot };
