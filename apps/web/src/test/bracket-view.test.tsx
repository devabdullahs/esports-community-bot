import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BracketView } from "@/components/tournaments/bracket-view";
import {
  TournamentMatchList,
  type TournamentMatchesPayload,
} from "@/components/tournaments/tournament-match-list";
import { projectTournamentBracket, type BracketMatchInput } from "@/lib/tournament-brackets";
import { projectTournamentDraw } from "@/lib/tournament-draw";

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

function bracketFixture() {
  const bracket = projectTournamentBracket([
    match({ id: 1, round: "Quarterfinals", has_details: true, scheduled_at: 100 }),
    match({ id: 2, round: "Quarterfinals", scheduled_at: 200 }),
    match({ id: 3, round: "Semifinals", scheduled_at: 300 }),
    match({ id: 4, round: "Grand Final", scheduled_at: 400 }),
  ]);
  if (!bracket) throw new Error("Bracket fixture should project");
  return bracket;
}

function payload(matches: BracketMatchInput[]): TournamentMatchesPayload {
  return {
    tournament: {
      id: 99,
      name: "Fixture event",
      game: "valorant",
      source: "liquipedia",
      url: null,
      ewc: false,
      completed: false,
      final_standings_section: null,
      syncHealth: { state: "fresh", lastSuccessAt: null, source: "liquipedia" },
    },
    matches: {
      running: [],
      scheduled: matches,
      finished: [],
      postponed: [],
      cancelled: [],
    },
    bracketMatches: matches,
    standings: [],
    totals: {
      running: 0,
      scheduled: matches.length,
      finished: 0,
      postponed: 0,
      cancelled: 0,
      all: matches.length,
    },
    finishedPage: { offset: 0, limit: 50, hasMore: false },
    total: matches.length,
  };
}

function renderMatchList(data: TournamentMatchesPayload) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TournamentMatchList tournamentId={data.tournament.id} locale="en" initialData={data} />
    </QueryClientProvider>,
  );
}

describe("BracketView", () => {
  test("offers every team in the draw so a run can be followed", () => {
    // Double elimination is a story about falling, and a team's run continues in the other
    // bracket. The control has to list the teams that actually appear, once each.
    const bracket = projectTournamentBracket([
      match({ id: 1, round: "Upper Bracket Round 1", team_a: "Alpha", team_b: "Bravo", scheduled_at: 100 }),
      match({ id: 2, round: "Upper Bracket Final", team_a: "Alpha", team_b: "Charlie", scheduled_at: 200 }),
      match({ id: 3, round: "Lower Bracket Round 1", team_a: "Bravo", team_b: "Delta", scheduled_at: 300 }),
    ]);
    if (!bracket) throw new Error("Bracket fixture should project");

    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <BracketView bracket={bracket} locale="en" />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-bracket-follow="true"');
    // Bravo plays in both brackets and must still be offered once.
    expect(html.match(/aria-pressed/g)?.length).toBe(4);
    // Nothing is dimmed until a team is chosen.
    expect(html).not.toContain('data-bracket-path');
  });

  test("hides the follow control when there is nobody to choose between", () => {
    const bracket = projectTournamentBracket([
      match({ id: 1, round: "Semifinals", team_a: null, team_b: null, scheduled_at: 100 }),
      match({ id: 2, round: "Grand Final", team_a: null, team_b: null, scheduled_at: 200 }),
    ]);
    if (!bracket) throw new Error("Bracket fixture should project");

    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <BracketView bracket={bracket} locale="en" />
      </QueryClientProvider>,
    );

    expect(html).not.toContain('data-bracket-follow');
  });

  test("stacks the upper and lower brackets instead of running them in one line", () => {
    // A double-elimination draw is two brackets. Laid out as one row of rounds, "Lower
    // Bracket Round 1" lands after the upper final and a team's fall reads as a jump
    // along the same line.
    const bracket = projectTournamentBracket([
      match({ id: 1, round: "Upper Bracket Round 1", scheduled_at: 100 }),
      match({ id: 2, round: "Upper Bracket Final", scheduled_at: 200 }),
      match({ id: 3, round: "Lower Bracket Round 1", scheduled_at: 300 }),
      match({ id: 4, round: "Lower Bracket Final", scheduled_at: 400 }),
    ]);
    if (!bracket) throw new Error("Bracket fixture should project");

    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <BracketView bracket={bracket} locale="en" />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-bracket-branch="upper"');
    expect(html).toContain('data-bracket-branch="lower"');
    // The upper band comes first, and every round sits inside a band rather than beside it.
    expect(html.indexOf('data-bracket-branch="upper"')).toBeLessThan(
      html.indexOf('data-bracket-branch="lower"'),
    );
  });

  test("keeps a single-branch draw as one band with no redundant heading", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <BracketView bracket={bracketFixture()} locale="en" />
      </QueryClientProvider>,
    );

    // Nothing to separate, so the band heading would only repeat the section title.
    expect(html).toContain('data-bracket-branch="open"');
    expect(html).not.toContain('data-bracket-branch="upper"');
  });

  test("renders responsive columns and links every match to its canonical page", () => {
    const html = renderToStaticMarkup(<BracketView bracket={bracketFixture()} locale="en" />);

    expect(html).toContain('data-bracket-view="true"');
    expect(html).toContain('data-bracket-columns="3"');
    expect(html).toContain("snap-x snap-mandatory");
    expect(html).toContain("lg:min-w-full");
    expect(html).toContain('href="/matches/1"');
    expect(html).toContain('href="/matches/2"');
    expect(html).toContain("Quarterfinals");
    expect(html).toContain("Grand final");
  });

  test("uses RTL direction and localized bracket labels", () => {
    const html = renderToStaticMarkup(<BracketView bracket={bracketFixture()} locale="ar" />);

    expect(html).toContain('dir="rtl"');
    expect(html).toContain("مسار البطولة");
    expect(html).toContain("ربع النهائي");
    expect(html).toContain('href="/ar/matches/1"');
    expect(html).toContain('href="/ar/matches/2"');
  });

  test("renders paused states and scoreless explicit outcomes semantically", () => {
    const bracket = projectTournamentBracket([
      match({
        id: 10,
        round: "Quarterfinals",
        status: "cancelled",
        result_reason: "cancelled",
        scheduled_at: 100,
      }),
      match({
        id: 11,
        round: "Semifinals",
        status: "finished",
        winner_side: "team2",
        result_reason: "walkover",
        scheduled_at: 200,
      }),
    ]);
    if (!bracket) throw new Error("Lifecycle bracket fixture should project");

    const html = renderToStaticMarkup(<BracketView bracket={bracket} locale="en" />);

    expect(html).toContain("Cancelled");
    expect(html).toContain("Bravo won by walkover");
    expect(html).not.toContain(">0<");
  });

  test("appears above the match sections only when a bracket can be projected", () => {
    const bracketHtml = renderMatchList(payload([
      match({ id: 1, round: "Quarterfinals" }),
      match({ id: 2, round: "Quarterfinals" }),
      match({ id: 3, round: "Semifinals" }),
    ]));
    const regularHtml = renderMatchList(payload([match({ id: 4, name: "Alpha vs Bravo" })]));

    expect(bracketHtml).toContain('data-bracket-view="true"');
    expect(bracketHtml.indexOf('data-bracket-view="true"')).toBeLessThan(bracketHtml.indexOf("Live now"));
    expect(bracketHtml).toContain('href="/matches/1"');
    expect(bracketHtml).toContain('id="tournament-match-1"');
    expect(regularHtml).not.toContain('data-bracket-view="true"');
  });
});

describe("BracketView, draw mode", () => {
  const ATTRIBUTION = "\u00a9 Esports Foundation 2026. All rights reserved.";

  function drawSlot(overrides: Record<string, unknown> = {}) {
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

  function drawRound(column: number, section: string, slots: unknown[]) {
    return { column, section, title: "UB Ro4", bracket: "upper", bestOf: 5, slots };
  }

  function drawFixture(rounds: unknown[], matchRows: Parameters<typeof projectTournamentDraw>[1] = []) {
    const draw = projectTournamentDraw(
      { payload: { attribution: ATTRIBUTION, facts: [], bracket: rounds }, updatedAt: null },
      matchRows,
    );
    if (!draw) throw new Error("Draw fixture should project");
    return draw;
  }

  function renderDraw(draw: ReturnType<typeof drawFixture>, locale: "en" | "ar" = "en") {
    return renderToStaticMarkup(
      <BracketView bracket={{ rounds: [] }} draw={draw} locale={locale} />,
    );
  }

  test("offers each drawn section and shows one at a time", () => {
    // Black Ops 7 draws both groups with identical round titles; merged they would read as one
    // round that never took place, and stacked they make a wall of cards.
    const html = renderDraw(
      drawFixture([
        drawRound(1, "Group A", [drawSlot()]),
        drawRound(1, "Group B", [drawSlot({ teamA: "Charlie", teamB: "Delta" })]),
      ]),
    );

    expect(html).toContain('data-bracket-source="sheet"');
    expect(html).toContain('data-bracket-sections="2"');
    expect(html).toContain("Group A");
    expect(html).toContain("Group B");
    // Only the selected section's panel is rendered.
    expect(html).toContain('data-bracket-section="groupa"');
    expect(html).not.toContain('data-bracket-section="groupb"');
  });

  test("opens on the section being played rather than the first one drawn", () => {
    // A tournament with several groups should answer "what is happening now", not "what
    // happened first" — Group A is often over for days before the event is.
    const html = renderDraw(
      drawFixture([
        drawRound(1, "Group A", [drawSlot({ scoreA: 3, scoreB: 1, status: "finished" })]),
        drawRound(1, "Group B", [
          drawSlot({ teamA: "Charlie", teamB: "Delta", scoreA: 1, scoreB: 1, status: "running" }),
        ]),
      ]),
    );

    expect(html).toContain('data-bracket-section="groupb"');
    expect(html).not.toContain('data-bracket-section="groupa"');
  });

  test("falls back to the most recently decided section when nothing is live", () => {
    const html = renderDraw(
      drawFixture([
        drawRound(1, "Group A", [drawSlot({ scoreA: 3, scoreB: 1, status: "finished" })]),
        drawRound(1, "Group B", [
          drawSlot({ teamA: "Charlie", teamB: "Delta", scoreA: 3, scoreB: 0, status: "finished" }),
        ]),
      ]),
    );

    expect(html).toContain('data-bracket-section="groupb"');
  });

  test("keeps a single-section draw free of a selector", () => {
    const html = renderDraw(drawFixture([drawRound(1, "Playoffs", [drawSlot()])]));

    expect(html).not.toContain("data-bracket-sections");
    expect(html).toContain('data-bracket-section="playoffs"');
  });

  test("names the feeder a slot is waiting on instead of showing a dash", () => {
    const rounds = [
      drawRound(1, "Playoffs", [drawSlot({ label: "UB 1.1" })]),
      drawRound(2, "Playoffs", [
        drawSlot({
          label: "UB 2.1",
          teamA: "Winner of UB 1.1",
          teamB: "TBD",
          sourceA: { outcome: "winner", slot: "UB 1.1" },
        }),
      ]),
    ];

    expect(renderDraw(drawFixture(rounds))).toContain("Winner of UB 1.1");
    // The same chip is localized rather than left as the sheet's English.
    const arabic = renderDraw(drawFixture(rounds), "ar");
    expect(arabic).toContain('dir="rtl"');
    expect(arabic).toContain("\u0627\u0644\u0641\u0627\u0626\u0632 \u0645\u0646 UB 1.1");
    expect(arabic).not.toContain("Winner of");
  });

  test("links only the slots that joined a stored match", () => {
    const html = renderDraw(
      drawFixture(
        [
          drawRound(1, "Playoffs", [drawSlot({ label: "UB 1.1" })]),
          drawRound(2, "Playoffs", [drawSlot({ label: "UB 2.1", teamA: "Charlie", teamB: "Delta" })]),
        ],
        [
          {
            id: 42,
            team_a: "Alpha",
            team_b: "Bravo",
            logo_a: null,
            logo_b: null,
            score_a: null,
            score_b: null,
            status: "scheduled",
          },
        ],
      ),
    );

    expect(html).toContain('href="/matches/42"');
    // An undrawn or unjoined slot has no page to go to, so it is not a link.
    expect(html.match(/<a /g)?.length).toBe(1);
  });

  test("draws an elbow only where real edges confirm the pairing", () => {
    const paired = renderDraw(
      drawFixture([
        drawRound(1, "Playoffs", [
          drawSlot({ label: "UB 1.1" }),
          drawSlot({ label: "UB 1.2", teamA: "Charlie", teamB: "Delta" }),
        ]),
        drawRound(2, "Playoffs", [
          drawSlot({
            label: "UB 2.1",
            teamA: "Winner of UB 1.1",
            teamB: "Winner of UB 1.2",
            sourceA: { outcome: "winner", slot: "UB 1.1" },
            sourceB: { outcome: "winner", slot: "UB 1.2" },
          }),
        ]),
      ]),
    );
    const unpaired = renderDraw(
      drawFixture([
        drawRound(1, "Playoffs", [drawSlot({ label: "UB 1.1" })]),
        drawRound(2, "Playoffs", [drawSlot({ label: "UB 2.1", teamA: "Charlie", teamB: "Delta" })]),
      ]),
    );

    expect(paired).toContain('data-connector="pair"');
    expect(paired.match(/data-feeds="pair"/g)?.length).toBe(2);
    expect(unpaired).not.toContain('data-connector="pair"');
  });

  test("never draws a connector in fallback mode", () => {
    // Matches within a label-projected round are time-sorted, not draw-sorted, so any line
    // drawn from that source would be confidently wrong.
    const html = renderToStaticMarkup(<BracketView bracket={bracketFixture()} locale="en" />);

    expect(html).toContain('data-bracket-source="labels"');
    expect(html).not.toContain("data-connector");
  });
});
