import { describe, expect, test } from "vitest";
import { classifyClubRegion, clubKey, isFeaturedClubName, regionFromLocation } from "@/lib/ewc-club-regions";

describe("EWC club region helpers", () => {
  test("classifies Gulf community favorites from the curated featured map", () => {
    expect(classifyClubRegion("Team Falcons")).toBe("gulf");
    expect(classifyClubRegion("Twisted Minds")).toBe("gulf");
    expect(classifyClubRegion("Geekay Esports")).toBe("gulf");
    expect(classifyClubRegion("AlUla Club")).toBe("gulf");
    expect(classifyClubRegion("Al Qadsiah")).toBe("gulf");
    expect(classifyClubRegion("NASR Esports")).toBe("gulf");
    expect(classifyClubRegion("R8 Esports")).toBe("gulf");
    expect(classifyClubRegion("ROC Esports")).toBe("gulf");
    expect(classifyClubRegion("Team Stallions")).toBe("gulf");
    expect(classifyClubRegion("Team Vision")).toBe("gulf");
  });

  test("classifies famous partner clubs across requested regions", () => {
    expect(classifyClubRegion("G2 Esports")).toBe("europe");
    expect(classifyClubRegion("FUT Esports")).toBe("west_asia_africa");
    expect(classifyClubRegion("100 Thieves")).toBe("north_america");
    expect(classifyClubRegion("FURIA")).toBe("south_america");
  });

  test("keeps every 2026 EF Club Partner Program club in the featured list", () => {
    const partnerClubs = [
      "100 Thieves",
      "9z Globant",
      "All Gamers",
      "Alpha7 Esports",
      "Cloud9",
      "Edward Gaming",
      "Fluxo W7M",
      "Fnatic",
      "FURIA",
      "FUT Esports",
      "G2 Esports",
      "GAM Esports",
      "Gen.G",
      "Gentle Mates",
      "GodLike",
      "HEROIC",
      "JD Gaming",
      "LEVIATAN",
      "MOUZ",
      "NAVI",
      "NIP.eStar",
      "NRG",
      "ONIC",
      "REJECT",
      "S8UL",
      "Sentinels",
      "T1",
      "Team Falcons",
      "Team Heretics",
      "Team Liquid",
      "Team RRQ",
      "Team Secret",
      "Team Spirit",
      "Team Vitality",
      "Titan Esports Club",
      "Twisted Minds",
      "Virtus.pro",
      "Weibo Gaming",
      "Wolves Esports",
      "ZETA DIVISION",
    ];

    expect(partnerClubs).toHaveLength(40);
    for (const club of partnerClubs) {
      expect(isFeaturedClubName(club), club).toBe(true);
      expect(classifyClubRegion(club), club).not.toBe("other");
    }
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
    expect(isFeaturedClubName("Al-Qadsiah")).toBe(true);
    expect(isFeaturedClubName("Nasr eSports")).toBe(true);
    expect(isFeaturedClubName("Vision Esports")).toBe(true);
    expect(regionFromLocation("United Arab Emirates")).toBe("gulf");
  });
});
