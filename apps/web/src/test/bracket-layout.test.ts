import { describe, expect, test } from "vitest";
import { buildBracketLayout, trackSpan } from "@/lib/bracket-layout";
import type { DrawEdge, DrawRound, DrawSlot, TournamentDraw } from "@/lib/tournament-draw";

function slot(key: string, overrides: Partial<DrawSlot> = {}): DrawSlot {
  return {
    key,
    label: key.toUpperCase(),
    branch: null,
    teamA: "Alpha",
    teamB: "Bravo",
    awaitingA: null,
    awaitingB: null,
    logoA: null,
    logoB: null,
    scoreA: null,
    scoreB: null,
    status: "scheduled",
    winner: null,
    matchId: null,
    ...overrides,
  };
}

function round(key: string, column: number, slots: DrawSlot[], branch: DrawRound["branch"] = null): DrawRound {
  return { key, column, title: key, branch, bestOf: null, slots };
}

function draw(rounds: DrawRound[], edges: DrawEdge[] = [], source: TournamentDraw["source"] = "sheet"): TournamentDraw {
  return { source, sections: [{ key: "s", title: "Playoffs", rounds, edges }] };
}

function edge(from: string, to: string, side: "a" | "b"): DrawEdge {
  return { from, to, side, outcome: "winner", kind: "declared" };
}

describe("trackSpan", () => {
  test("divides a round's tracks gaplessly and without overlap", () => {
    // Four over four, two over four, one over four: the halving a real bracket produces.
    expect([0, 1, 2, 3].map((i) => trackSpan(i, 4, 4))).toEqual([
      { row: 1, span: 1 },
      { row: 2, span: 1 },
      { row: 3, span: 1 },
      { row: 4, span: 1 },
    ]);
    expect([0, 1].map((i) => trackSpan(i, 2, 4))).toEqual([
      { row: 1, span: 2 },
      { row: 3, span: 2 },
    ]);
    expect(trackSpan(0, 1, 4)).toEqual({ row: 1, span: 4 });
  });

  test("stays gapless for a round that does not halve", () => {
    const spans = [0, 1].map((i) => trackSpan(i, 2, 3));
    expect(spans).toEqual([
      { row: 1, span: 1 },
      { row: 2, span: 2 },
    ]);
    // No row is claimed twice and none is left behind.
    expect(spans[0].row + spans[0].span).toBe(spans[1].row);
  });
});

describe("buildBracketLayout", () => {
  test("reads columns off the sheet so branches stay aligned", () => {
    // A sheet column can hold more than one round and columns can be sparse; the author
    // already lined the branches up, so position in the sorted column list is the track.
    const layout = buildBracketLayout(
      draw([
        round("ub1", 2, [slot("a"), slot("b")], "upper"),
        round("ub2", 9, [slot("c")], "upper"),
        round("lb1", 5, [slot("d")], "lower"),
      ]),
    );

    const columns = layout.sections[0].bands.flatMap((band) =>
      band.rounds.map((entry) => [entry.key, entry.column] as const),
    );
    expect(Object.fromEntries(columns)).toEqual({ ub1: 1, ub2: 3, lb1: 2 });
    expect(layout.sections[0].columns).toBe(3);
  });

  test("stacks the branches and lands the grand final at the right of the upper band", () => {
    const layout = buildBracketLayout(
      draw([
        round("ub1", 1, [slot("a")], "upper"),
        round("lb1", 2, [slot("b")], "lower"),
        round("gf", 3, [slot("c")]),
      ]),
    );

    const bands = layout.sections[0].bands;
    expect(bands.map((band) => band.branch)).toEqual(["upper", "lower"]);
    expect(bands[0].rounds.map((entry) => entry.key)).toEqual(["ub1", "gf"]);
    expect(bands[1].rounds.map((entry) => entry.key)).toEqual(["lb1"]);
  });

  test("keeps a single-branch draw as one band", () => {
    const layout = buildBracketLayout(draw([round("r1", 1, [slot("a"), slot("b")]), round("r2", 2, [slot("c")])]));

    expect(layout.sections[0].bands).toHaveLength(1);
    expect(layout.sections[0].bands[0].branch).toBeNull();
    expect(layout.sections[0].bands[0].tracks).toBe(2);
  });

  test("offsets the lower branch by one round in fallback mode", () => {
    // Nothing in a label-projected bracket records geometry, only order — and the first lower
    // round cannot be concurrent with the upper round that feeds it.
    const layout = buildBracketLayout(
      draw(
        [
          round("ub1", 0, [slot("a")], "upper"),
          round("ub2", 1, [slot("b")], "upper"),
          round("lb1", 2, [slot("c")], "lower"),
          round("gf", 3, [slot("d")]),
        ],
        [],
        "labels",
      ),
    );

    const columns = Object.fromEntries(
      layout.sections[0].bands.flatMap((band) => band.rounds.map((entry) => [entry.key, entry.column] as const)),
    );
    expect(columns).toEqual({ ub1: 1, ub2: 2, lb1: 2, gf: 3 });
  });

  test("draws an elbow only where real edges arrive on aligned halves", () => {
    const layout = buildBracketLayout(
      draw(
        [round("r1", 1, [slot("a"), slot("b")]), round("r2", 2, [slot("c")])],
        [edge("a", "c", "a"), edge("b", "c", "b")],
      ),
    );

    const [first, second] = layout.sections[0].bands[0].rounds;
    expect(second.cells[0]).toMatchObject({ row: 1, span: 2, connector: true });
    expect(first.cells.map((cell) => cell.feedsConnector)).toEqual([true, true]);
  });

  test("draws nothing when only one edge arrives", () => {
    const layout = buildBracketLayout(
      draw([round("r1", 1, [slot("a"), slot("b")]), round("r2", 2, [slot("c")])], [edge("a", "c", "a")]),
    );

    expect(layout.sections[0].bands[0].rounds[1].cells[0].connector).toBe(false);
  });

  test("draws nothing when the feeders are not in the immediately preceding column", () => {
    const layout = buildBracketLayout(
      draw(
        [
          round("r1", 1, [slot("a"), slot("b")]),
          round("r2", 2, [slot("x"), slot("y")]),
          round("r3", 3, [slot("c")]),
        ],
        [edge("a", "c", "a"), edge("b", "c", "b")],
      ),
    );

    expect(layout.sections[0].bands[0].rounds[2].cells[0].connector).toBe(false);
  });

  test("draws nothing across the gap between bands", () => {
    // A loser's drop is told by a chip; a line across the gap would be spaghetti and would
    // imply a geometry neither band has.
    const layout = buildBracketLayout(
      draw(
        [
          round("ub1", 1, [slot("a"), slot("b")], "upper"),
          round("lb1", 2, [slot("c")], "lower"),
        ],
        [edge("a", "c", "a"), edge("b", "c", "b")],
      ),
    );

    expect(layout.sections[0].bands[1].rounds[0].cells[0].connector).toBe(false);
  });

  test("draws nothing when the feeders do not sit on the cell's halves", () => {
    // Three into two: the pairing is real but the elbow's 25%/75% assumption does not hold,
    // so the line is withheld rather than pointed at the wrong rows.
    const layout = buildBracketLayout(
      draw(
        [round("r1", 1, [slot("a"), slot("b"), slot("c")]), round("r2", 2, [slot("d"), slot("e")])],
        [edge("a", "d", "a"), edge("b", "d", "b")],
      ),
    );

    expect(layout.sections[0].bands[0].rounds[1].cells[0].connector).toBe(false);
  });

  test("never draws in fallback mode, because it has no edges to justify a line", () => {
    const layout = buildBracketLayout(
      draw([round("r1", 1, [slot("a"), slot("b")]), round("r2", 2, [slot("c")])], [], "labels"),
    );

    expect(layout.source).toBe("labels");
    expect(layout.sections[0].bands[0].rounds.flatMap((entry) => entry.cells).some((cell) => cell.connector)).toBe(
      false,
    );
  });
});
