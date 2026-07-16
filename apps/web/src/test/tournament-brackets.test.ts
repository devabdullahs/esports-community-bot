import { describe, expect, test } from "vitest";
import {
  bracketRoundFromStoredMatch,
  projectTournamentBracket,
  type BracketMatchInput,
} from "@/lib/tournament-brackets";

function match(overrides: Partial<BracketMatchInput> = {}): BracketMatchInput {
  return {
    id: 1,
    name: "Alpha vs Bravo",
    team_a: "Alpha",
    team_b: "Bravo",
    logo_a: null,
    logo_b: null,
    score_a: null,
    score_b: null,
    status: "scheduled",
    scheduled_at: 1_780_000_000,
    ...overrides,
  };
}

describe("projectTournamentBracket", () => {
  test("projects a single-elimination bracket in stage order and keeps matches time-sorted", () => {
    const bracket = projectTournamentBracket([
      match({ id: 4, round: "Quarterfinals", scheduled_at: 300 }),
      match({ id: 2, round: "Quarterfinals", scheduled_at: 100 }),
      match({ id: 3, round: "Semifinals", scheduled_at: 400 }),
      match({ id: 5, round: "Semifinals", scheduled_at: 500 }),
      match({
        id: 6,
        round: "Grand Final",
        status: "finished",
        score_a: 3,
        score_b: 1,
        scheduled_at: 600,
      }),
    ]);

    expect(bracket?.rounds.map((round) => round.kind)).toEqual([
      "quarterfinal",
      "semifinal",
      "grand-final",
    ]);
    expect(bracket?.rounds[0].matches.map((item) => item.id)).toEqual([2, 4]);
    expect(bracket?.rounds[2].matches[0].winner).toBe("a");
  });

  test("recognizes upper/lower branches and a third-place match", () => {
    const bracket = projectTournamentBracket([
      match({ id: 1, round: "Upper Bracket Semifinals" }),
      match({ id: 2, round: "Upper Bracket Final" }),
      match({ id: 3, round: "Lower Bracket Round 1" }),
      match({ id: 4, round: "Lower Bracket Final" }),
      match({ id: 5, round: "Third Place Match" }),
      match({ id: 6, round: "Grand Final" }),
    ]);

    expect(bracket?.rounds.map((round) => [round.branch, round.kind])).toEqual([
      ["upper", "semifinal"],
      ["upper", "final"],
      ["lower", "numeric"],
      ["lower", "final"],
      [null, "third-place"],
      [null, "grand-final"],
    ]);
  });

  test("uses persisted round tokens for incomplete TBD brackets without returning provider IDs", () => {
    const first = match({
      id: 1,
      external_id: "Match:ID_fixture_R01-M001",
      team_b: "TBD",
      scheduled_at: 100,
    });
    const second = match({
      id: 2,
      external_id: "Match:ID_fixture_R01-M002",
      scheduled_at: 200,
    });
    const final = match({
      id: 3,
      external_id: "Match:ID_fixture_R02-M001",
      team_a: "TBD",
      team_b: "TBD",
      scheduled_at: null,
    });

    expect(bracketRoundFromStoredMatch(first)).toBe("Round 1");
    const bracket = projectTournamentBracket([first, second, final]);
    expect(bracket?.rounds.map((round) => round.label)).toEqual(["Round 1", "Round 2"]);
    expect(bracket?.rounds[0].matches[0].team_b).toBe("TBD");
    expect(JSON.stringify(bracket)).not.toContain("Match:ID_fixture");
  });

  test("returns null for standings-only, group, and ambiguous numeric rounds", () => {
    expect(projectTournamentBracket([])).toBeNull();
    expect(
      projectTournamentBracket([
        match({ id: 1, round: "Group A" }),
        match({ id: 2, round: "Group B" }),
      ]),
    ).toBeNull();
    expect(
      projectTournamentBracket([
        match({ id: 1, round: "Round 1" }),
        match({ id: 2, round: "Round 1" }),
        match({ id: 3, round: "Round 2" }),
        match({ id: 4, round: "Round 2" }),
      ]),
    ).toBeNull();
  });
});
