"use client";

import type { StreamPlatform } from "@/lib/stream-types";

type EmbedUrlOptions = {
  platform: StreamPlatform;
  handle: string;
  parent: string;
  videoId?: string | null;
  autoplay?: boolean;
};

const PLATFORM_LABELS: Partial<Record<StreamPlatform, string>> = {
  twitch: "Twitch",
  kick: "Kick",
  youtube: "YouTube",
};

// Provider identifiers remain typed inputs; shared query state never becomes
// an iframe URL directly. Twitch's parent is validated by the server page.
export function embedUrl({ platform, handle, parent, videoId = null, autoplay = true }: EmbedUrlOptions): string | null {
  if (platform === "twitch") {
    if (!parent) return null;
    const url = new URL("https://player.twitch.tv/");
    url.searchParams.set("channel", handle);
    url.searchParams.set("parent", parent);
    url.searchParams.set("autoplay", String(autoplay));
    url.searchParams.set("muted", "true");
    return url.toString();
  }
  if (platform === "kick") {
    return `https://player.kick.com/${encodeURIComponent(handle)}?autoplay=${autoplay}&muted=true`;
  }
  if (platform === "youtube" && videoId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=0&playsinline=1`;
  }
  return null;
}

export function StreamEmbed({
  platform,
  handle,
  parent,
  videoId = null,
  label,
  autoplay = true,
}: {
  platform: StreamPlatform;
  handle: string;
  parent: string;
  videoId?: string | null;
  label: string;
  autoplay?: boolean;
}) {
  const src = embedUrl({ platform, handle, parent, videoId, autoplay });
  if (!src) return null;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
      <iframe
        key={src}
        src={src}
        title={`${label} on ${PLATFORM_LABELS[platform] ?? platform}`}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 size-full"
      />
    </div>
  );
}
