"use client";

import type { StreamPlatform } from "@/lib/stream-types";

// Twitch/Kick embed by handle; YouTube embeds the LIVE VIDEO (the poller
// resolves its id — a channel URL cannot be iframed). `parent` (Twitch
// requirement) is the host serving the page, e.g. esportscommunity.net.
export function embedUrl(platform: StreamPlatform, handle: string, parent: string, videoId?: string | null): string | null {
  if (platform === "twitch") {
    return `https://player.twitch.tv/?channel=${encodeURIComponent(handle)}&parent=${encodeURIComponent(parent)}`;
  }
  if (platform === "kick") {
    return `https://player.kick.com/${encodeURIComponent(handle)}`;
  }
  if (platform === "youtube" && videoId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;
  }
  return null;
}

export function StreamEmbed({
  platform,
  handle,
  parent,
  videoId = null,
}: {
  platform: StreamPlatform;
  handle: string;
  parent: string;
  videoId?: string | null;
}) {
  const src = embedUrl(platform, handle, parent, videoId);
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
