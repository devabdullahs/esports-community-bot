import { describe, expect, test } from "vitest";
import {
  escapeIcsText,
  getMatchCalendarForViewer,
  serializeMatchCalendarIcs,
  type CalendarMatch,
} from "@/lib/match-calendar";
import type { CalendarMatchRow } from "@/lib/follows";

const now = 1_800_000_000;

const match: CalendarMatch = {
  id: 42,
  tournamentId: 7,
  tournamentName: "Cup; One",
  game: "Val,orant",
  teamA: "Falcons; Team",
  teamB: "Liquid\\\nAcademy",
  scheduledAt: now,
};

describe("match calendar", () => {
  test("escapes text, emits UTC fields, stable UIDs, and RFC-style folded lines", () => {
    expect(escapeIcsText("A;B,C\\D\r\nE")).toBe("A\\;B\\,C\\\\D\\nE");

    const ics = serializeMatchCalendarIcs([
      match,
      { ...match, id: 43, teamA: "A".repeat(100) },
    ], now);

    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("UID:match-42@esports-community-bot\r\n");
    expect(ics).toContain("DTSTART:20270115T080000Z\r\n");
    expect(ics).toContain("DTEND:20270115T100000Z\r\n");
    expect(ics).toContain("SUMMARY:Falcons\\; Team vs Liquid\\\\\\nAcademy\r\n");
    expect(ics).toContain("DESCRIPTION:Tournament: Cup\\; One\\nGame: Val\\,orant\r\n");
    expect(ics).toMatch(/\r\n A/);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const line of ics.split("\r\n").filter(Boolean)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  test("keeps the response bounded and only projects the scheduled match data", async () => {
    const rows: CalendarMatchRow[] = [
      ...Array.from({ length: 205 }, (_, index) => ({
        ...match,
        id: index + 1,
        scheduledAt: now + index,
        status: "scheduled" as const,
      })),
      { ...match, id: 500, scheduledAt: now - 1, status: "scheduled" },
      { ...match, id: 501, scheduledAt: now + 31 * 24 * 60 * 60, status: "scheduled" },
      { ...match, id: 1, scheduledAt: now + 500, status: "scheduled" },
    ];
    const payload = await getMatchCalendarForViewer("200000000000000001", now, {
      matches: async () => rows,
    });

    expect(payload.matches).toHaveLength(200);
    expect(payload.matches).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ id: 500 }),
      expect.objectContaining({ id: 501 }),
    ]));
    expect(payload.matches.filter((item) => item.id === 1)).toHaveLength(1);
    expect(payload.window).toEqual({ startsAt: now, endsAt: now + 30 * 24 * 60 * 60 });
    expect(payload.matches[0]).toEqual({
      id: 1,
      tournamentId: 7,
      tournamentName: "Cup; One",
      game: "Val,orant",
      teamA: "Falcons; Team",
      teamB: "Liquid\\\nAcademy",
      scheduledAt: now,
    });
  });
});
