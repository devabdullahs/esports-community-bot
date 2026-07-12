import { describe, expect, test } from "vitest";
import {
  breadcrumbList,
  localizedMatchDescription,
  localizedTournamentDescription,
  serializeStructuredData,
  sportsEvent,
  structuredDataGraph,
} from "@/lib/structured-data";

describe("structured metadata", () => {
  test("builds unique localized leaf descriptions", () => {
    const englishTournament = localizedTournamentDescription({
      locale: "en",
      name: "Riyadh Masters",
      game: "Dota 2",
    });
    const arabicTournament = localizedTournamentDescription({
      locale: "ar",
      name: "Riyadh Masters",
      game: "Dota 2",
    });
    const englishMatch = localizedMatchDescription({
      locale: "en",
      teamA: "Falcons",
      teamB: "Liquid",
      tournamentName: "Riyadh Masters",
      game: "Dota 2",
    });

    expect(englishTournament).toContain("Riyadh Masters in Dota 2");
    expect(arabicTournament).toContain("Riyadh Masters في Dota 2");
    expect(englishMatch).toContain("Falcons vs Liquid in Riyadh Masters");
    expect(new Set([englishTournament, arabicTournament, englishMatch]).size).toBe(3);
  });

  test("builds ordered breadcrumbs inside a schema graph", () => {
    const pageUrl = "https://example.test/ar/tournaments/42";
    const graph = structuredDataGraph([
      breadcrumbList([
        { name: "الرئيسية", url: "https://example.test/ar" },
        { name: "البطولات", url: "https://example.test/ar/tournaments" },
        { name: "Riyadh Masters", url: pageUrl },
      ], pageUrl),
    ]);

    expect(graph).toMatchObject({
      "@context": "https://schema.org",
      "@graph": [{
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          { position: 1, name: "الرئيسية", item: "https://example.test/ar" },
          { position: 2, name: "البطولات", item: "https://example.test/ar/tournaments" },
          { position: 3, name: "Riyadh Masters", item: pageUrl },
        ],
      }],
    });
  });

  test("builds SportsEvent only for a complete, timestamped match", () => {
    const complete = {
      url: "https://example.test/matches/7",
      locale: "en" as const,
      teamA: "Falcons",
      teamB: "Liquid",
      scheduledAt: 1_700_000_000,
      details: { kind: "dota2" },
      status: "scheduled" as const,
      tournamentName: "Riyadh Masters",
      tournamentUrl: "https://example.test/tournaments/42",
      game: "Dota 2",
      description: "Falcons vs Liquid match details.",
    };

    expect(sportsEvent(complete)).toMatchObject({
      "@type": "SportsEvent",
      name: "Falcons vs Liquid",
      startDate: "2023-11-14T22:13:20.000Z",
      eventStatus: "https://schema.org/EventScheduled",
      sport: "Dota 2",
      competitor: [
        { "@type": "Organization", name: "Falcons" },
        { "@type": "Organization", name: "Liquid" },
      ],
    });
    expect(sportsEvent({ ...complete, teamB: "TBD" })).toBeNull();
    expect(sportsEvent({ ...complete, details: null })).toBeNull();
    expect(sportsEvent({ ...complete, scheduledAt: null })).toBeNull();
    expect(sportsEvent({ ...complete, scheduledAt: Number.MAX_VALUE })).toBeNull();
  });

  test("escapes data before embedding it in an inline JSON script", () => {
    const payload = {
      name: "</script><script>alert('xss')</script>",
      separator: "line\u2028paragraph\u2029end",
      ampersand: "A&B",
    };
    const serialized = serializeStructuredData(payload);

    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/u);
    expect(JSON.parse(serialized)).toEqual(payload);
  });
});
