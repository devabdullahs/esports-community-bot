import { describe, expect, test } from "vitest";
import { classifyClubRegion, clubKey, isFeaturedClubName, regionFromLocation } from "@/lib/ewc-club-regions";

describe("EWC club region helpers", () => {
  test("classifies Gulf community favorites from the curated featured map", () => {
    expect(classifyClubRegion("Team Falcons")).toBe("gulf");
    expect(classifyClubRegion("Twisted Minds")).toBe("gulf");
    expect(classifyClubRegion("Geekay Esports")).toBe("gulf");
  });

  test("classifies famous partner clubs across requested regions", () => {
    expect(classifyClubRegion("G2 Esports")).toBe("europe");
    expect(classifyClubRegion("FUT Esports")).toBe("west_asia_africa");
    expect(classifyClubRegion("100 Thieves")).toBe("north_america");
    expect(classifyClubRegion("FURIA")).toBe("south_america");
  });

  test("falls back to synced team profile location when a club is not curated", () => {
    expect(classifyClubRegion("Example Club", { location: "Saudi Arabia" })).toBe("gulf");
    expect(classifyClubRegion("Example Club", { facts: { region: "Brazil" } })).toBe("south_america");
    expect(classifyClubRegion("Example Club", { nationality: "KR" })).toBe("asia_pacific");
  });

  test("normalizes punctuation and accents for matching", () => {
    expect(clubKey("NIP.eStar")).toBe("nip estar");
    expect(clubKey("LEVIATÁN")).toBe("leviatan");
    expect(isFeaturedClubName("Leviatán Esports")).toBe(true);
    expect(regionFromLocation("United Arab Emirates")).toBe("gulf");
  });
});
