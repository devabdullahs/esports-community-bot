import { describe, expect, test } from "vitest";
import {
  ALL_CO_STREAM_FILTER,
  DEFAULT_CO_STREAM_FILTERS,
  coStreamGames,
  coStreamLanguages,
  filterCoStreams,
  firstVisibleLiveCoStreamId,
  hasActiveCoStreamFilters,
  normalizeCoStreamLanguage,
  selectedCoStreamIdAfterFiltering,
} from "@/lib/co-stream-filtering";
import type { CoStream, CoStreamChannel, StreamPlatform } from "@/lib/stream-types";

function stream(id: string, overrides: Partial<CoStream> = {}): CoStream {
  const platform: StreamPlatform = "twitch";
  const channel: CoStreamChannel = {
    id: Number(id.replace(/\D/g, "")) || 1,
    platform,
    handle: `${id}-handle`,
    label: `Creator ${id}`,
    scope: "ewc",
    creatorKey: id,
    gameSlug: null,
    gameSlugs: ["valorant"],
    teamKey: null,
    matchExternalId: null,
    language: "en",
    sortOrder: 0,
    isDefault: true,
    active: true,
    addedBy: null,
    createdAt: "2026-07-17 00:00:00",
    updatedAt: "2026-07-17 00:00:00",
    url: `https://twitch.tv/${id}-handle`,
    isLive: true,
    liveTitle: `Live ${id}`,
    liveGame: "Valorant",
    viewerCount: 100,
    startedAt: 1_700_000_000,
    videoId: null,
  };

  return {
    id,
    label: `Creator ${id}`,
    creatorKey: id,
    gameSlugs: ["valorant"],
    language: "en",
    channels: [channel],
    embedChannel: channel,
    isLive: true,
    liveTitle: `Live ${id}`,
    liveGame: "Valorant",
    viewerCount: 100,
    startedAt: 1_700_000_000,
    sortOrder: 0,
    ...overrides,
  };
}

describe("co-stream filtering", () => {
  const streams = [
    stream("english-valorant", { language: "en-US" }),
    stream("arabic-valorant", { language: "Arabic" }),
    stream("arabic-cs", {
      language: "ar_SA",
      gameSlugs: ["counter-strike-2"],
      channels: [
        {
          ...stream("channel").channels[0],
          platform: "kick",
          language: "ar",
        },
      ],
    }),
    stream("offline-arabic", { language: "ar", isLive: false }),
  ];

  test("normalizes language codes and creator labels", () => {
    expect(normalizeCoStreamLanguage(" ar_SA ")).toBe("ar");
    expect(normalizeCoStreamLanguage("English")).toBe("en");
    expect(normalizeCoStreamLanguage(" ")).toBeNull();
    expect(coStreamLanguages(streams)).toEqual(["ar", "en"]);
    expect(coStreamGames(streams)).toEqual(["valorant", "counter-strike-2"]);
  });

  test("selecting Arabic combines with game and platform filters", () => {
    const arabic = filterCoStreams(streams, {
      ...DEFAULT_CO_STREAM_FILTERS,
      language: "ar",
    });
    expect(arabic.map((stream) => stream.id)).toEqual(["arabic-valorant", "arabic-cs", "offline-arabic"]);

    const arabicKickCs = filterCoStreams(streams, {
      platform: "kick",
      game: "counter-strike-2",
      language: "ar",
      liveOnly: true,
    });
    expect(arabicKickCs.map((stream) => stream.id)).toEqual(["arabic-cs"]);
  });

  test("clearing filters restores all streams and reports inactive state", () => {
    const arabicFilters = { ...DEFAULT_CO_STREAM_FILTERS, language: "ar" };
    expect(hasActiveCoStreamFilters(arabicFilters)).toBe(true);
    expect(hasActiveCoStreamFilters(DEFAULT_CO_STREAM_FILTERS)).toBe(false);
    expect(filterCoStreams(streams, DEFAULT_CO_STREAM_FILTERS).map((stream) => stream.id)).toEqual(
      streams.map((stream) => stream.id),
    );
    expect(ALL_CO_STREAM_FILTER).toBe("all");
  });

  test("keeps a visible selection and falls back to the first visible live stream", () => {
    const arabicFilters = { ...DEFAULT_CO_STREAM_FILTERS, language: "ar" };
    expect(firstVisibleLiveCoStreamId(streams, arabicFilters)).toBe("arabic-valorant");
    expect(selectedCoStreamIdAfterFiltering("arabic-cs", streams, arabicFilters)).toBe("arabic-cs");
    expect(selectedCoStreamIdAfterFiltering("english-valorant", streams, arabicFilters)).toBe("arabic-valorant");
    expect(selectedCoStreamIdAfterFiltering("english-valorant", streams, DEFAULT_CO_STREAM_FILTERS)).toBe(
      "english-valorant",
    );
    expect(firstVisibleLiveCoStreamId(streams, { ...arabicFilters, game: "missing" })).toBeNull();
  });
});
