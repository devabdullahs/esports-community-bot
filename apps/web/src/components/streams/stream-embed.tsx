"use client";

import type { StreamPlatform } from "@/lib/stream-types";

// Only Twitch and Kick are embeddable here — those are the platforms the poller
// tracks live status for. `parent` (Twitch requirement) is the host serving the
// page, e.g. esportscommunity.net.
export function embedUrl(platform: StreamPlatform, handle: string, parent: string): string | null {
  if (platform === "twitch") {
    return `https://player.twitch.tv/?channel=${encodeURIComponent(handle)}&parent=${encodeURIComponent(parent)}`;
  }
  if (platform === "kick") {
    return `https://player.kick.com/${encodeURIComponent(handle)}`;
  }
  return null;
}

export function StreamEmbed({
  platform,
  handle,
  parent,
}: {
  platform: StreamPlatform;
  handle: string;
  parent: string;
}) {
  const src = embedUrl(platform, handle, parent);
  if (!src) return null;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
      <iframe
        key={src}
        src={src}
        title={`${handle} live stream`}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 size-full"
      />
    </div>
  );
}
