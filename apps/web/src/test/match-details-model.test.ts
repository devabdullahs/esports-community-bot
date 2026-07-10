import { describe, expect, test } from "vitest";
import { toMatchDetailsViewModel } from "@/lib/match-details";
import { matchHasDetails } from "@/lib/tournaments";

describe("match details page model", () => {
  test("maps a Valorant payload without changing aligned sides", () => {
    const model = toMatchDetailsViewModel({
      version: 1,
      kind: "valorant",
      patch: "13.00",
      casters: ["Paperthin"],
      veto: [{ order: 1, action: "ban", map: "Sunset", team: "b" }],
      maps: [{
        name: "Fracture",
        duration: "38:21",
        scoreA: 13,
        scoreB: 2,
        winner: "a",
        players: {
          a: [{ name: "Alpha", agents: ["Neon"], acs: 250, kills: 16, deaths: 7, assists: 2, kastPct: "80%", adr: 165, hsPct: "30%", fk: 4, fd: 2 }],
          b: [{ name: "Bravo", agents: ["Jett"], acs: 180, kills: 7, deaths: 16, assists: 1, kastPct: "50%", adr: 90, hsPct: "20%", fk: 1, fd: 4 }],
        },
      }],
    });

    expect(model).toMatchObject({
      kind: "valorant",
      veto: [{ team: "b", map: "Sunset" }],
      maps: [{ scoreA: 13, scoreB: 2, winner: "a", players: { a: [{ name: "Alpha" }], b: [{ name: "Bravo" }] } }],
    });
  });

  test("maps Dota drafts, team stats, and players by their stored sides", () => {
    const model = toMatchDetailsViewModel({
      version: 1,
      kind: "dota2",
      patch: "7.41d",
      casters: [],
      games: [{
        number: 1,
        winner: "b",
        duration: "31:18",
        sides: { a: "dire", b: "radiant" },
        draft: {
          a: { picks: [{ hero: "Drow Ranger", order: 8 }], bans: [] },
          b: { picks: [{ hero: "Spectre", order: 24 }], bans: [] },
        },
        teamStats: {
          a: { kills: 10, deaths: 37, assists: 20, gold: "65.2K", towers: 0, barracks: 0, roshans: 0 },
          b: { kills: 37, deaths: 10, assists: 70, gold: "80.4K", towers: 4, barracks: 0, roshans: 2 },
        },
        players: {
          a: [{ name: "Alpha", hero: "Drow Ranger", kills: 0, deaths: 9, assists: 1, dmg: "4.7K", lhdn: "239/8", net: "13.5K", gpm: 430 }],
          b: [{ name: "Bravo", hero: "Spectre", kills: 6, deaths: 2, assists: 17, dmg: "25.3K", lhdn: "321/5", net: "20.9K", gpm: 668 }],
        },
      }],
    });

    expect(model).toMatchObject({
      kind: "dota2",
      games: [{
        winner: "b",
        sides: { a: "dire", b: "radiant" },
        teamStats: { a: { gold: "65.2K", towers: 0 }, b: { gold: "80.4K", towers: 4 } },
        players: { a: [{ name: "Alpha" }], b: [{ name: "Bravo" }] },
      }],
    });
  });

  test("rejects malformed or unsupported envelopes and maps database detail flags", () => {
    expect(toMatchDetailsViewModel(null)).toBeNull();
    expect(toMatchDetailsViewModel({ version: 2, kind: "valorant" })).toBeNull();
    expect(toMatchDetailsViewModel({ version: 1, kind: "leagueoflegends" })).toBeNull();
    expect(matchHasDetails(1)).toBe(true);
    expect(matchHasDetails(true)).toBe(true);
    expect(matchHasDetails(0)).toBe(false);
    expect(matchHasDetails(undefined)).toBe(false);
  });
});
