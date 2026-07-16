import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MatchCalendarPanelContent } from "@/components/dashboard/match-calendar-panel";
import { copy } from "@/lib/i18n";
import type { MatchCalendarPayload } from "@/lib/match-calendar";

const populated: MatchCalendarPayload = {
  matches: [
    {
      id: 42,
      tournamentId: 5,
      tournamentName: "Summer Cup",
      game: "Valorant",
      teamA: "Team Falcons",
      teamB: "Team Liquid",
      scheduledAt: 1_800_000_000,
    },
  ],
  window: { startsAt: 1_800_000_000, endsAt: 1_802_592_000 },
};

describe("MatchCalendarPanelContent", () => {
  test("renders populated English and Arabic match calendars with individual ICS links", () => {
    const english = renderToStaticMarkup(<MatchCalendarPanelContent locale="en" payload={populated} />);
    const arabic = renderToStaticMarkup(<MatchCalendarPanelContent locale="ar" payload={populated} />);

    expect(english).toContain("Match calendar");
    expect(english).toContain("Team Falcons");
    expect(english).toContain("Add to calendar");
    expect(english).toContain('href="/api/me/calendar/ics?match=42"');
    expect(english).toContain('href="/api/me/calendar/ics"');
    expect(arabic).toContain(copy.ar.profile.matchCalendar);
    expect(arabic).toContain(copy.ar.profile.addToCalendar);
    expect(arabic).toContain("<bdi>Team Falcons vs Team Liquid</bdi>");
  });

  test("renders an empty state and a loading state", () => {
    const empty = renderToStaticMarkup(
      <MatchCalendarPanelContent locale="en" payload={{ ...populated, matches: [] }} />,
    );
    const loading = renderToStaticMarkup(<MatchCalendarPanelContent locale="en" loading />);

    expect(empty).toContain("No upcoming matches from your follows");
    expect(empty).not.toContain("Add to calendar");
    expect(loading).toContain('aria-busy="true"');
  });
});
