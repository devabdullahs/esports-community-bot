import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BracketView } from "@/components/tournaments/bracket-view";
import {
  TournamentMatchList,
  type TournamentMatchesPayload,
} from "@/components/tournaments/tournament-match-list";
import { projectTournamentBracket, type BracketMatchInput } from "@/lib/tournament-brackets";

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
    matches: { running: [], scheduled: matches, finished: [] },
    standings: [],
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
  test("renders responsive columns and uses detail or list-anchor links", () => {
    const html = renderToStaticMarkup(<BracketView bracket={bracketFixture()} locale="en" />);

    expect(html).toContain('data-bracket-view="true"');
    expect(html).toContain('data-bracket-columns="3"');
    expect(html).toContain("snap-x snap-mandatory");
    expect(html).toContain("lg:min-w-full");
    expect(html).toContain('href="/matches/1"');
    expect(html).toContain('href="#tournament-match-2"');
    expect(html).toContain("Quarterfinals");
    expect(html).toContain("Grand final");
  });

  test("uses RTL direction and localized bracket labels", () => {
    const html = renderToStaticMarkup(<BracketView bracket={bracketFixture()} locale="ar" />);

    expect(html).toContain('dir="rtl"');
    expect(html).toContain("مسار البطولة");
    expect(html).toContain("ربع النهائي");
    expect(html).toContain('href="/ar/matches/1"');
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
    expect(bracketHtml).toContain('href="#tournament-match-1"');
    expect(bracketHtml).toContain('id="tournament-match-1"');
    expect(regularHtml).not.toContain('data-bracket-view="true"');
  });
});
