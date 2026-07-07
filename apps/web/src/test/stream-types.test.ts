import { describe, expect, test } from "vitest";
import { STREAM_DEFAULT_EMBED_PLATFORMS, STREAM_PLATFORMS } from "@/lib/stream-types";

describe("stream platform admin defaults", () => {
  test("YouTube can be selected as the admin default embed platform", () => {
    expect(STREAM_PLATFORMS).toContain("youtube");
    expect(STREAM_DEFAULT_EMBED_PLATFORMS).toEqual(["twitch", "kick", "youtube"]);
    expect(STREAM_DEFAULT_EMBED_PLATFORMS).not.toContain("soop");
  });
});
