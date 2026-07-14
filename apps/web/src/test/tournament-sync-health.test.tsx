import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TournamentSyncHealthStatus } from "@/components/tournaments/tournament-sync-health";
import type { TournamentMatchesPayload } from "@/components/tournaments/tournament-match-list";

function payload(state: TournamentMatchesPayload["tournament"]["syncHealth"]["state"]): TournamentMatchesPayload {
  return {
    tournament: {
      id: 99,
      name: "Fixture event",
      game: "valorant",
      source: "liquipedia",
      url: "https://liquipedia.net/valorant/Fixture",
      ewc: false,
      completed: state === "final",
      final_standings_section: null,
      syncHealth: { state, lastSuccessAt: 1_700_000_000, source: "liquipedia" },
    },
    matches: { running: [], scheduled: [], finished: [] },
    standings: [],
    total: 0,
  };
}

function render(state: TournamentMatchesPayload["tournament"]["syncHealth"]["state"], locale: "en" | "ar" = "en") {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TournamentSyncHealthStatus tournamentId={99} locale={locale} initialData={payload(state)} />
    </QueryClientProvider>,
  );
}

describe("TournamentSyncHealthStatus", () => {
  test.each([
    ["fresh", "Fresh"],
    ["delayed", "Delayed"],
    ["unavailable", "Source unavailable"],
    ["final", "Final data"],
  ] as const)("renders the %s public state", (state, label) => {
    const html = render(state);
    expect(html).toContain(`data-sync-health=\"${state}\"`);
    expect(html).toContain(label);
    expect(html).toContain("dateTime=\"2023-11-14T22:13:20.000Z\"");
  });

  test("shows a lag warning only for delayed/unavailable data and a safe issue handoff", () => {
    expect(render("fresh")).not.toContain("Displayed data may lag");
    expect(render("delayed")).toContain("Displayed data may lag");
    expect(render("unavailable")).toContain("Displayed data may be delayed");
    const html = render("unavailable");
    expect(html).toContain("mailto:contact@esportscommunity.net?subject=Tournament%20%2399%20-%20Liquipedia");
    expect(html).not.toMatch(/responseBody|credential|token|raw_error/i);
  });

  test("renders localized Arabic copy in RTL-ready content", () => {
    const html = render("delayed", "ar");
    expect(html).toContain("\u0645\u062a\u0623\u062e\u0631");
    expect(html).toContain("\u0642\u062f \u062a\u062a\u0623\u062e\u0631 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629");
  });
});
