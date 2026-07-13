import { describe, expect, test } from "vitest";
import {
  breadcrumbList,
  localizedMatchDescription,
  localizedTournamentDescription,
  serializeStructuredData,
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
