import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MultiStreamGrid } from "@/components/streams/multi-stream-grid";
import {
  MAX_MULTI_STREAMS,
  effectiveLoadedStreamIds,
  initialLoadedStreamIds,
  initialSelectedStreamIds,
  loadedIdsAfterStreamAdded,
  loadedIdsAfterStreamLoad,
  multiviewGridClass,
  multiviewTileClass,
  reconcileLoadedStreamIds,
  reconcileSelectedStreamIds,
  reorderSelectedStreamIds,
  sanitizeRequestedStreamIds,
  singlePlayerSelectionIds,
  streamSelectionSearchParams,
  toggleSelectedStreamId,
} from "@/lib/co-stream-multiview";
import type { CoStream, CoStreamChannel } from "@/lib/stream-types";

function stream(id: string, overrides: Partial<CoStream> = {}): CoStream {
  const embedChannel: CoStreamChannel = {
    id: Number(id.replace(/\D/g, "")) || 1,
    platform: "twitch",
    handle: `handle-${id}`,
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
    createdAt: "2026-07-12 00:00:00",
    updatedAt: "2026-07-12 00:00:00",
    url: `https://twitch.tv/handle-${id}`,
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
    channels: [embedChannel],
    embedChannel,
    isLive: true,
    liveTitle: `Live ${id}`,
    liveGame: "Valorant",
    viewerCount: 100,
    startedAt: 1_700_000_000,
    sortOrder: 0,
    ...overrides,
  };
}

describe("co-stream multiview state", () => {
  test("sanitizes duplicate, blank, control-character, and overlong query IDs", () => {
    expect(sanitizeRequestedStreamIds([" alpha ", "", "alpha", "bad\nvalue", "x".repeat(241), "beta"])).toEqual([
      "alpha",
      "beta",
    ]);
  });

  test("caps requested IDs and search pairs at six", () => {
    const ids = Array.from({ length: 7 }, (_, index) => `stream-${index + 1}`);
    expect(sanitizeRequestedStreamIds(ids)).toEqual(ids.slice(0, MAX_MULTI_STREAMS));
    expect(streamSelectionSearchParams(ids)).toEqual(ids.slice(0, MAX_MULTI_STREAMS).map((id) => ["stream", id]));
  });

  test("an explicit stale query does not select an unrelated fallback", () => {
    expect(initialSelectedStreamIds(["missing"], [stream("one")], true)).toEqual([]);
  });

  test("no query selects the first live embeddable group", () => {
    const offline = stream("offline", { isLive: false });
    const noEmbed = stream("no-embed", { embedChannel: null });
    expect(initialSelectedStreamIds([], [offline, noEmbed, stream("first"), stream("second")], false)).toEqual([
      "first",
    ]);
  });

  test("reconciliation preserves order and offline selections while pruning removed groups", () => {
    const offline = stream("two", { isLive: false, embedChannel: null });
    expect(reconcileSelectedStreamIds(["two", "missing", "one", "two"], [stream("one"), offline])).toEqual([
      "two",
      "one",
    ]);
  });

  test("poll reconciliation cannot exceed six or reorder selected IDs", () => {
    const ids = Array.from({ length: 7 }, (_, index) => `poll-${index + 1}`);
    const polledStreams = [...ids].reverse().map((id) => stream(id));
    expect(reconcileSelectedStreamIds(ids, polledStreams)).toEqual(ids.slice(0, MAX_MULTI_STREAMS));
  });

  test("reorders selected streams without losing or duplicating IDs", () => {
    expect(reorderSelectedStreamIds(["tollmos", "shelby", "hovji"], "tollmos", "hovji")).toEqual([
      "shelby",
      "hovji",
      "tollmos",
    ]);
    expect(reorderSelectedStreamIds(["one", "two"], "missing", "two")).toEqual(["one", "two"]);
  });

  test("initial loaded state contains at most the first eligible selected stream", () => {
    const offline = stream("one", { isLive: false });
    expect(initialLoadedStreamIds(["one", "two", "three"], [offline, stream("two"), stream("three")])).toEqual(["two"]);
  });

  test("loaded state remains an ordered subset of selection even when status changes", () => {
    expect(reconcileLoadedStreamIds(["two", "one", "two", "missing"], ["one", "two"])).toEqual(["two", "one"]);
  });

  test("mobile single-player mode keeps the active stream and discards the rest", () => {
    expect(singlePlayerSelectionIds(["one", "two", "three"], ["two"])).toEqual(["two"]);
    expect(singlePlayerSelectionIds(["one", "two"], ["missing"])).toEqual(["one"]);
    expect(singlePlayerSelectionIds([], ["one"])).toEqual([]);
  });

  test("desktop mounts every selected stream while mobile keeps only its loaded player", () => {
    expect(effectiveLoadedStreamIds(["one", "two", "three"], ["one"], false)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(effectiveLoadedStreamIds(["one", "two"], ["two"], true)).toEqual(["two"]);
  });

  test("adding another mobile stream keeps the current player and leaves the new selection as a poster", () => {
    expect(loadedIdsAfterStreamAdded(["one"], ["one", "two"], "two", true)).toEqual(["one"]);
  });

  test("loading a mobile poster replaces the active player", () => {
    expect(loadedIdsAfterStreamLoad(["one"], ["one", "two"], "two", true)).toEqual(["two"]);
  });

  test("desktop additions and poster loads preserve simultaneous playback", () => {
    expect(loadedIdsAfterStreamAdded(["one"], ["one", "two"], "two", false)).toEqual(["one", "two"]);
    expect(loadedIdsAfterStreamLoad(["one"], ["one", "two"], "two", false)).toEqual(["one", "two"]);
  });

  test("duplicate add is idempotent and an existing selection toggles off", () => {
    expect(toggleSelectedStreamId(["one"], "one", ["one"])).toEqual({
      ids: [],
      limitReached: false,
    });
  });

  test("a seventh add is blocked with limit feedback", () => {
    const ids = Array.from({ length: 6 }, (_, index) => `stream-${index + 1}`);
    expect(toggleSelectedStreamId(ids, "stream-7", [...ids, "stream-7"])).toEqual({
      ids,
      limitReached: true,
    });
  });

  test.each(Array.from({ length: 10 }, (_, count) => count))("returns a bounded grid class for count %i", (count) => {
    expect(multiviewGridClass(count)).toContain("grid");
    expect(multiviewGridClass(count)).toContain("multiview-grid");
  });

  test("uses the requested asymmetric centered desktop layouts", () => {
    expect(multiviewGridClass(3)).toContain("xl:grid-cols-4");
    expect(multiviewTileClass(3, 0)).toContain("xl:col-start-2");
    expect(multiviewGridClass(4)).toContain("xl:grid-cols-2");
    expect(multiviewGridClass(5)).toContain("xl:grid-cols-6");
    expect(multiviewGridClass(5)).toContain("multiview-fit-wide-two-rows");
    expect(multiviewGridClass(5)).toContain("multiview-grid");
    expect(multiviewTileClass(5, 0)).toContain("xl:col-start-2");
    expect(multiviewGridClass(6)).toContain("xl:grid-cols-3");
  });
});

const GRID_STRINGS = {
  multiView: "Multiview",
  watching: "watching",
  loadStream: "Load stream",
  streamEnded: "Stream ended",
  removeStream: "Remove stream",
  openOn: (platform: string) => `Open on ${platform}`,
  enterFullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  fullscreenFailed: "Fullscreen failed",
  reorderStream: (name: string) => `Reorder ${name}`,
  streamMoved: (name: string) => `${name} moved`,
  mobileTwitchUnavailable: "Open Twitch on mobile",
};

function renderGrid(
  selected: CoStream[],
  loadedIds: string[],
  autoplay = true,
  twitchEmbedsSupported = true,
  compactViewport = false,
) {
  return renderToStaticMarkup(
    <MultiStreamGrid
      selected={selected}
      loadedIds={loadedIds}
      parent="localhost"
      strings={GRID_STRINGS}
      autoplay={autoplay}
      twitchEmbedsSupported={twitchEmbedsSupported}
      compactViewport={compactViewport}
      onLoad={() => undefined}
      onRemove={() => undefined}
      onReorder={() => undefined}
    />,
  );
}

function count(markup: string, pattern: RegExp) {
  return markup.match(pattern)?.length ?? 0;
}

describe("MultiStreamGrid static rendering", () => {
  test("a single stream has no remove or reorder controls", () => {
    const markup = renderGrid([stream("only")], ["only"]);
    expect(markup).not.toContain("Remove stream: Creator only");
    expect(markup).not.toContain("Reorder Creator only");
  });

  test("multiple streams expose remove and reorder controls", () => {
    const markup = renderGrid([stream("one"), stream("two")], ["one", "two"]);
    expect(markup).toContain("Remove stream: Creator one");
    expect(markup).toContain("Reorder Creator one");
  });

  test.each([1, 3, 6])("renders exactly %i loaded iframes", (streamCount) => {
    const streams = Array.from({ length: streamCount }, (_, index) => stream(`loaded-${index + 1}`));
    const markup = renderGrid(
      streams,
      streams.map((item) => item.id),
    );
    expect(count(markup, /<iframe/g)).toBe(streamCount);
  });

  test("defensively renders at most six items and iframes", () => {
    const streams = Array.from({ length: 7 }, (_, index) => stream(`bounded-${index + 1}`));
    const markup = renderGrid(
      streams,
      streams.map((item) => item.id),
    );
    expect(count(markup, /data-stream-tile=/g)).toBe(6);
    expect(count(markup, /<iframe/g)).toBe(6);
  });

  test("iframe titles identify the creator and platform", () => {
    const markup = renderGrid([stream("title")], ["title"]);
    expect(markup).toContain('title="Creator title on Twitch"');
  });

  test("passes the mobile no-autoplay policy into the active iframe URL", () => {
    const markup = renderGrid([stream("mobile")], ["mobile"], false);
    expect(markup).toContain("autoplay=false");
    expect(markup).not.toContain("autoplay=true");
  });

  test("does not mount an unsupported narrow-screen Twitch iframe", () => {
    const markup = renderGrid([stream("narrow")], ["narrow"], false, false);
    expect(count(markup, /<iframe/g)).toBe(0);
    expect(markup).toContain("Open Twitch on mobile");
    expect(markup).toContain('href="https://twitch.tv/handle-narrow"');
  });

  test("keeps supported mobile providers embeddable and gives Twitch its minimum height", () => {
    const twitchMarkup = renderGrid([stream("wide-mobile")], ["wide-mobile"], false, true, true);
    expect(twitchMarkup).toContain("min-h-[300px]");

    const kickChannel = {
      ...stream("kick").embedChannel!,
      platform: "kick" as const,
      url: "https://kick.com/kick",
    };
    const kick = stream("kick", {
      embedChannel: kickChannel,
      channels: [kickChannel],
    });
    const kickMarkup = renderGrid([kick], ["kick"], false, false, true);
    expect(kickMarkup).toContain("https://player.kick.com/handle-kick");
  });

  test("offline selections retain a fixed tile without an iframe", () => {
    const offline = stream("offline-tile", {
      isLive: false,
      embedChannel: null,
    });
    const markup = renderGrid([offline], [offline.id]);
    expect(count(markup, /data-stream-tile=/g)).toBe(1);
    expect(count(markup, /<iframe/g)).toBe(0);
    expect(markup).toContain("Stream ended");
    expect(markup).toContain("aspect-video");
  });

  test("shared selections mount one iframe and one poster per remaining stream", () => {
    const streams = Array.from({ length: 6 }, (_, index) => stream(`shared-${index + 1}`));
    const markup = renderGrid(streams, [streams[0].id]);
    expect(count(markup, /<iframe/g)).toBe(1);
    expect(count(markup, />Load stream<\/button>/g)).toBe(5);
  });
});
