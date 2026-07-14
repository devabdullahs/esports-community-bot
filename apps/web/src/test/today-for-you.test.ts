import { describe, expect, test, vi } from "vitest";
import {
  getTodayForViewer,
  type TodayForYouLoaders,
} from "@/lib/today-for-you";

const viewerId = "200000000000099001";
const guildId = "200000000000099002";

function loaders(overrides: Partial<TodayForYouLoaders> = {}): TodayForYouLoaders {
  return {
    matches: vi.fn(async () => ({
      live: [],
      upcoming: [],
    })),
    unreadNotifications: vi.fn(async () => []),
    unreadCount: vi.fn(async () => 0),
    follows: vi.fn(async () => []),
    actionableRounds: vi.fn(async () => []),
    coStreams: vi.fn(async () => []),
    ...overrides,
  } as unknown as TodayForYouLoaders;
}

describe("getTodayForViewer", () => {
  test("keeps bounded deterministic activity and strips member-private fields", async () => {
    const source = loaders({
      matches: vi.fn(async () => ({
        live: [
          { id: 1, tournamentId: 11, tournamentName: "Live Cup", game: "valorant", teamA: "Alpha", teamB: "Beta", status: "running", scheduledAt: 100 },
          { id: 1, tournamentId: 11, tournamentName: "Live Cup", game: "valorant", teamA: "Alpha", teamB: "Beta", status: "running", scheduledAt: 100 },
          ...Array.from({ length: 5 }, (_, index) => ({
            id: index + 2,
            tournamentId: 11,
            tournamentName: "Live Cup",
            game: "valorant",
            teamA: `Alpha ${index}`,
            teamB: `Beta ${index}`,
            status: "running" as const,
            scheduledAt: 101 + index,
          })),
        ],
        upcoming: [
          { id: 20, tournamentId: 12, tournamentName: "Next Cup", game: "valorant", teamA: "Gamma", teamB: "Delta", status: "scheduled", scheduledAt: 200 },
        ],
      })),
      unreadNotifications: vi.fn(async () => [
        {
          id: 1,
          discord_user_id: viewerId,
          type: "match_result",
          match_id: 4,
          title: "Alpha won",
          body: "Live Cup",
          url: "http://localhost:3000/tournaments/11",
          dedupe_key: "private-key",
          read_at: null,
          dm_status: "sent",
          created_at: "2026-07-14 10:00:00",
        },
        ...Array.from({ length: 3 }, (_, index) => ({
          id: index + 2,
          discord_user_id: viewerId,
          type: "match_start" as const,
          match_id: index + 20,
          title: `Match ${index}`,
          body: "Soon",
          url: "",
          dedupe_key: `private-${index}`,
          read_at: null,
          dm_status: "skipped" as const,
          created_at: "2026-07-14 10:00:00",
        })),
      ]),
      unreadCount: vi.fn(async () => 4),
      follows: vi.fn(async () => [
        { id: 1, discord_user_id: viewerId, entity_type: "game", entity_key: "valorant", entity_label: "Valorant", entity_ref: "", created_at: "2026-07-14" },
      ]),
      actionableRounds: vi.fn(async () => [
        {
          label: "Week three",
          status: "open",
          closesAt: 500,
          nextLockAt: 400,
          openGames: 2,
          totalGames: 3,
          pickedGames: 1,
          hiddenPick: "never expose this",
        },
      ]),
      coStreams: vi.fn(async () => [
        {
          label: "Valorant Live",
          gameSlugs: ["valorant"],
          isLive: true,
          liveGame: "Valorant",
          liveTitle: "Playoffs",
          viewerCount: 100,
          startedAt: 300,
        },
        {
          label: "Off game",
          gameSlugs: ["dota2"],
          isLive: true,
          liveGame: "Dota 2",
          liveTitle: "Elsewhere",
          viewerCount: 50,
          startedAt: 300,
        },
      ]),
    });

    const payload = await getTodayForViewer(viewerId, guildId, "2026", 123, source);

    expect(vi.mocked(source.matches)).toHaveBeenCalledWith(viewerId, { nowSec: 123, liveLimit: 5, upcomingLimit: 5 });
    expect(payload.liveMatches.map((match) => match.id)).toEqual([1, 2, 3, 4, 5]);
    expect(payload.upcomingMatches.map((match) => match.id)).toEqual([20]);
    expect(payload.unreadNotifications).toHaveLength(3);
    expect(payload.unreadNotifications[0]).toEqual({
      type: "match_result",
      title: "Alpha won",
      body: "Live Cup",
      href: "/tournaments/11",
      createdAt: "2026-07-14 10:00:00",
    });
    expect(payload.actionableRounds[0]).not.toHaveProperty("hiddenPick");
    expect(payload.coStreams.items).toEqual([
      { label: "Valorant Live", game: "Valorant", title: "Playoffs", viewerCount: 100, startedAt: 300 },
    ]);
    expect(JSON.stringify(payload)).not.toContain("discord_user_id");
    expect(JSON.stringify(payload)).not.toContain("private-key");
  });

  test("keeps personalized data closed when the optional co-stream section fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = await getTodayForViewer(
      viewerId,
      guildId,
      "2026",
      123,
      loaders({ coStreams: vi.fn(async () => { throw new Error("unavailable"); }) }),
    );

    expect(payload.coStreams).toEqual({ available: false, items: [] });
    expect(error).toHaveBeenCalledWith("[today-for-you] cached co-stream section unavailable");
    error.mockRestore();
  });
});
