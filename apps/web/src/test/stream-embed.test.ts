import { describe, expect, test } from "vitest";
import { embedUrl } from "@/components/streams/stream-embed";
import type { StreamPlatform } from "@/lib/stream-types";

const ALLOWED_ORIGINS = new Set([
  "https://player.twitch.tv",
  "https://player.kick.com",
  "https://www.youtube-nocookie.com",
]);

describe("embedUrl", () => {
  test("builds a muted autoplay Twitch URL with the required parent", () => {
    const value = embedUrl({ platform: "twitch", handle: "creator name/&", parent: "localhost" });
    const url = new URL(value!);
    expect(url.origin).toBe("https://player.twitch.tv");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      channel: "creator name/&",
      parent: "localhost",
      autoplay: "true",
      muted: "true",
    });
    expect(embedUrl({ platform: "twitch", handle: "creator", parent: "" })).toBeNull();
  });

  test("builds an encoded muted autoplay Kick URL", () => {
    const value = embedUrl({ platform: "kick", handle: "creator name/&", parent: "localhost" });
    const url = new URL(value!);
    expect(url.origin).toBe("https://player.kick.com");
    expect(url.pathname).toBe("/creator%20name%2F%26");
    expect(Object.fromEntries(url.searchParams)).toEqual({ autoplay: "true", muted: "true" });
  });

  test("uses the YouTube no-cookie player with autoplay off and no mute parameter", () => {
    const value = embedUrl({
      platform: "youtube",
      handle: "channel",
      parent: "localhost",
      videoId: "video id/&",
    });
    const url = new URL(value!);
    expect(url.origin).toBe("https://www.youtube-nocookie.com");
    expect(url.pathname).toBe("/embed/video%20id%2F%26");
    expect(Object.fromEntries(url.searchParams)).toEqual({ autoplay: "0", playsinline: "1" });
    expect(url.searchParams.has("mute")).toBe(false);
    expect(url.searchParams.has("enablejsapi")).toBe(false);
  });

  test("returns null for YouTube without a live video ID and for unsupported platforms", () => {
    expect(embedUrl({ platform: "youtube", handle: "channel", parent: "localhost" })).toBeNull();
    expect(embedUrl({ platform: "soop", handle: "creator", parent: "localhost" })).toBeNull();
  });

  test.each([
    { platform: "twitch" as const, handle: "one", parent: "example.com" },
    { platform: "kick" as const, handle: "two", parent: "example.com" },
    { platform: "youtube" as const, handle: "three", parent: "example.com", videoId: "video" },
  ])("only returns a CSP-allowlisted host for $platform", (options) => {
    const value = embedUrl(options as {
      platform: StreamPlatform;
      handle: string;
      parent: string;
      videoId?: string;
    });
    expect(value).not.toBeNull();
    expect(ALLOWED_ORIGINS.has(new URL(value!).origin)).toBe(true);
  });
});
