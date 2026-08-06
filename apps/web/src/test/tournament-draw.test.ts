import { describe, expect, test } from "vitest";
import {
  drawFromLabelProjection,
  isPlaceholderCompetitor,
  projectTournamentDraw,
  type DrawMatchRow,
} from "@/lib/tournament-draw";
import { projectTournamentBracket, type BracketMatchInput } from "@/lib/tournament-brackets";

const ATTRIBUTION = "© Esports Foundation 2026. All rights reserved.";

type RawSlot = {
  label?: string;
  bracket?: string;
  teamA?: string;
  teamB?: string;
  scoreA?: number | null;
  scoreB?: number | null;
  status?: string;
  sourceA?: { outcome: string; slot: string } | null;
  sourceB?: { outcome: string; slot: string } | null;
};

function slot(overrides: RawSlot = {}): RawSlot {
  return {
    label: "UB 1.1",
    bracket: "upper",
    teamA: "Alpha",
    teamB: "Bravo",
    scoreA: null,
    scoreB: null,
    status: "scheduled",
    sourceA: null,
    sourceB: null,
    ...overrides,
  };
}

function overview(bracket: unknown, attribution: unknown = ATTRIBUTION) {
  return { payload: { attribution, facts: [], bracket }, updatedAt: null };
}

/** The shape `parseBracketStructure` persists: a flat list of rounds, each naming its section. */
function round(column: number, section: string, slots: RawSlot[], extra: Record<string, unknown> = {}) {
  return { column, section, title: "UB Ro8", bracket: "upper", bestOf: 5, slots, ...extra };
}

function matchRow(overrides: Partial<DrawMatchRow> = {}): DrawMatchRow {
  return {
    id: 1,
    team_a: "Alpha",
    team_b: "Bravo",
    logo_a: "https://cdn.example/a.png",
    logo_b: "https://cdn.example/b.png",
    score_a: null,
    score_b: null,
    status: "scheduled",
    ...overrides,
  };
}

describe("projectTournamentDraw", () => {
  test("refuses a payload that is not the official workbook", () => {
    // The attribution gate is what makes the rest of the payload trustworthy enough to render.
    expect(projectTournamentDraw(overview([round(1, "Group A", [slot()])], "anything else"))).toBeNull();
    expect(
      projectTournamentDraw({ payload: { bracket: [round(1, "Group A", [slot()])] }, updatedAt: null }),
    ).toBeNull();
    expect(projectTournamentDraw(null)).toBeNull();
  });

  test("returns null when the workbook holds no draw, so the caller keeps today's behaviour", () => {
    expect(projectTournamentDraw(overview([]))).toBeNull();
    expect(projectTournamentDraw(overview("not an array"))).toBeNull();
    expect(projectTournamentDraw(overview([round(1, "Group A", [])]))).toBeNull();
  });

  test("keeps two identically-titled group draws apart as sections", () => {
    // Black Ops 7 draws both of its groups as "UB Ro8 (Quarter-finals)"; merged into one
    // bracket they would read as a single eight-team round that never existed.
    const draw = projectTournamentDraw(
      overview([
        round(1, "Group A", [slot({ label: "UB 1.1" })]),
        round(1, "Group B", [slot({ label: "UB 1.1", teamA: "Charlie", teamB: "Delta" })]),
      ]),
    );

    expect(draw?.source).toBe("sheet");
    expect(draw?.sections).toHaveLength(2);
    expect(draw?.sections.map((section) => section.title)).toEqual(["Group A", "Group B"]);
  });

  test("orders a section's rounds by the sheet column the author drew them in", () => {
    const draw = projectTournamentDraw(
      overview([
        round(5, "Playoffs", [slot({ label: "UB 2.1" })]),
        round(1, "Playoffs", [slot({ label: "UB 1.1" })]),
      ]),
    );

    expect(draw?.sections[0].rounds.map((entry) => entry.column)).toEqual([1, 5]);
  });

  test("resolves an edge the sheet wrote down", () => {
    const draw = projectTournamentDraw(
      overview([
        round(1, "Playoffs", [slot({ label: "UB 1.1" })]),
        round(3, "Playoffs", [
          slot({
            label: "UB 2.1",
            teamA: "Winner of UB 1.1",
            teamB: "TBD",
            sourceA: { outcome: "winner", slot: "UB 1.1" },
          }),
        ]),
      ]),
    );

    const edges = draw?.sections[0].edges ?? [];
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ side: "a", outcome: "winner", kind: "declared" });
    // A side naming its feeder is not a competitor, so it carries a chip rather than a name.
    const target = draw?.sections[0].rounds[1].slots[0];
    expect(target?.teamA).toBeNull();
    expect(target?.awaitingA).toEqual({ outcome: "winner", slot: "UB 1.1" });
    expect(target?.teamB).toBeNull();
  });

  test("draws nothing for a reference that cannot be resolved without ambiguity", () => {
    const duplicated = projectTournamentDraw(
      overview([
        round(1, "Playoffs", [slot({ label: "UB 1.1" }), slot({ label: "UB 1.1", teamA: "Charlie" })]),
        round(3, "Playoffs", [
          slot({ label: "UB 2.1", teamA: "Winner of UB 1.1", sourceA: { outcome: "winner", slot: "UB 1.1" } }),
        ]),
      ]),
    );
    const missing = projectTournamentDraw(
      overview([
        round(1, "Playoffs", [slot({ label: "UB 1.1" })]),
        round(3, "Playoffs", [
          slot({ label: "UB 2.1", teamA: "Winner of LB 9.9", sourceA: { outcome: "winner", slot: "LB 9.9" } }),
        ]),
      ]),
    );

    expect(duplicated?.sections[0].edges).toEqual([]);
    expect(missing?.sections[0].edges).toEqual([]);
    // The chip still renders — only the connector is withheld.
    expect(missing?.sections[0].rounds[1].slots[0].awaitingA).toEqual({ outcome: "winner", slot: "LB 9.9" });
  });

  test("traces a decided team into the slot it advanced to", () => {
    // Once the sheet fills a slot in, the declared source is overwritten by the team name;
    // the link survives because the team literally appears in both slots.
    const draw = projectTournamentDraw(
      overview([
        round(1, "Playoffs", [
          slot({ label: "UB 1.1", scoreA: 3, scoreB: 1, status: "finished" }),
        ]),
        round(3, "Playoffs", [slot({ label: "UB 2.1", teamA: "Alpha", teamB: "Charlie" })]),
      ]),
    );

    const edges = draw?.sections[0].edges ?? [];
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ side: "a", outcome: "winner", kind: "traced" });
  });

  test("traces the loser of an earlier slot into the lower bracket", () => {
    const draw = projectTournamentDraw(
      overview([
        round(1, "Playoffs", [slot({ label: "UB 1.1", scoreA: 3, scoreB: 1, status: "finished" })]),
        round(3, "Playoffs", [slot({ label: "LB 1.1", teamA: "Bravo", teamB: "Charlie" })]),
      ]),
    );

    expect(draw?.sections[0].edges[0]).toMatchObject({ outcome: "loser", kind: "traced" });
  });

  test("refuses to trace when the same team decided two earlier slots in one column", () => {
    const draw = projectTournamentDraw(
      overview([
        round(1, "Playoffs", [
          slot({ label: "UB 1.1", scoreA: 3, scoreB: 1, status: "finished" }),
          slot({ label: "UB 1.2", teamA: "Alpha", teamB: "Charlie", scoreA: 3, scoreB: 0, status: "finished" }),
        ]),
        round(3, "Playoffs", [slot({ label: "UB 2.1", teamA: "Alpha", teamB: "Delta" })]),
      ]),
    );

    expect(draw?.sections[0].edges.filter((edge) => edge.kind === "traced")).toEqual([]);
  });

  test("does not trace an undecided earlier slot", () => {
    const draw = projectTournamentDraw(
      overview([
        round(1, "Playoffs", [slot({ label: "UB 1.1" })]),
        round(3, "Playoffs", [slot({ label: "UB 2.1", teamA: "Alpha", teamB: "Charlie" })]),
      ]),
    );

    expect(draw?.sections[0].edges).toEqual([]);
  });

  test("joins a slot to its stored match row and takes the row's authority", () => {
    const draw = projectTournamentDraw(
      overview([round(1, "Playoffs", [slot({ label: "UB 1.1" })])]),
      [matchRow({ id: 77, score_a: 3, score_b: 2, status: "finished" })],
    );

    const joined = draw?.sections[0].rounds[0].slots[0];
    expect(joined?.matchId).toBe(77);
    expect(joined?.status).toBe("finished");
    expect(joined?.scoreA).toBe(3);
    expect(joined?.winner).toBe("a");
    expect(joined?.logoA).toBe("https://cdn.example/a.png");
  });

  test("flips the joined row when the sheet drew the sides the other way round", () => {
    const draw = projectTournamentDraw(
      overview([round(1, "Playoffs", [slot({ label: "UB 1.1", teamA: "Bravo", teamB: "Alpha" })])]),
      [matchRow({ id: 78, score_a: 3, score_b: 0, status: "finished" })],
    );

    const joined = draw?.sections[0].rounds[0].slots[0];
    // The row has Alpha 3 - 0 Bravo; the sheet drew Bravo first, so the score follows the draw.
    expect(joined?.scoreA).toBe(0);
    expect(joined?.scoreB).toBe(3);
    expect(joined?.winner).toBe("b");
    expect(joined?.logoA).toBe("https://cdn.example/b.png");
  });

  test("disambiguates a rematch by score and otherwise leaves the slot unlinked", () => {
    const rows = [
      matchRow({ id: 10, score_a: 3, score_b: 0, status: "finished" }),
      matchRow({ id: 11, score_a: 3, score_b: 2, status: "finished" }),
    ];
    const resolved = projectTournamentDraw(
      overview([round(1, "Playoffs", [slot({ label: "UB 1.1", scoreA: 3, scoreB: 2, status: "finished" })])]),
      rows,
    );
    const ambiguous = projectTournamentDraw(
      overview([round(1, "Playoffs", [slot({ label: "UB 1.1" })])]),
      rows,
    );

    expect(resolved?.sections[0].rounds[0].slots[0].matchId).toBe(11);
    expect(ambiguous?.sections[0].rounds[0].slots[0].matchId).toBeNull();
  });

  test("drops sheet text that fails the sanitizer", () => {
    const draw = projectTournamentDraw(
      overview([
        round(1, "Group A", [slot({ teamA: "https://docs.google.com/spreadsheets/d/x", teamB: "Bravo" })], {
          title: "https://docs.google.com/leak",
        }),
      ]),
    );

    const rendered = JSON.stringify(draw);
    expect(rendered).not.toContain("docs.google");
    expect(draw?.sections[0].rounds[0].title).toBeNull();
    expect(draw?.sections[0].rounds[0].slots[0].teamA).toBeNull();
  });

  test("reads a placeholder side as undrawn rather than as a competitor", () => {
    expect(isPlaceholderCompetitor("TBD")).toBe(true);
    expect(isPlaceholderCompetitor("Q")).toBe(true);
    expect(isPlaceholderCompetitor("Winner of UB 1.1")).toBe(true);
    expect(isPlaceholderCompetitor("")).toBe(true);
    expect(isPlaceholderCompetitor("Team Falcons")).toBe(false);
  });

  test("honours the injected normalizer so cross-source aliases still join", () => {
    const draw = projectTournamentDraw(
      overview([round(1, "Playoffs", [slot({ label: "UB 1.1", teamA: "AlUla Club Esports", teamB: "Bravo" })])]),
      [matchRow({ id: 90, team_a: "AlUla Club" })],
      { normalizeName: (value) => (/alula/i.test(String(value ?? "")) ? "alula" : String(value ?? "").toLowerCase()) },
    );

    expect(draw?.sections[0].rounds[0].slots[0].matchId).toBe(90);
  });
});

describe("drawFromLabelProjection", () => {
  function match(overrides: Partial<BracketMatchInput> = {}): BracketMatchInput {
    return {
      id: 1,
      team_a: "Alpha",
      team_b: "Bravo",
      logo_a: null,
      logo_b: null,
      score_a: null,
      score_b: null,
      status: "scheduled",
      scheduled_at: 100,
      ...overrides,
    };
  }

  test("wraps the label projection as one edge-less section", () => {
    // Matches within a round are time-sorted, not draw-sorted, so any feeder line drawn from
    // this source would be confidently wrong.
    const bracket = projectTournamentBracket([
      match({ id: 1, round: "Quarterfinals" }),
      match({ id: 2, round: "Quarterfinals", scheduled_at: 200 }),
      match({ id: 3, round: "Semifinals", scheduled_at: 300 }),
    ]);
    if (!bracket) throw new Error("Bracket fixture should project");

    const draw = drawFromLabelProjection(bracket);

    expect(draw.source).toBe("labels");
    expect(draw.sections).toHaveLength(1);
    expect(draw.sections[0].edges).toEqual([]);
    expect(draw.sections[0].rounds.map((entry) => entry.column)).toEqual([0, 1]);
    // Every slot is already a real match row, so every card links.
    expect(draw.sections[0].rounds.flatMap((entry) => entry.slots).every((entry) => entry.matchId != null)).toBe(true);
  });
});
