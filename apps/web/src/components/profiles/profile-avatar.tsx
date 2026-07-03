"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { displayImageUrl } from "@/lib/logo-url";
import { safeUrlOrUndefined } from "@/lib/safe-url";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

// Player photos and team crests come from PandaScore's CDN (rendered as-is) or
// Liquipedia (rewritten to our caching proxy — hotlinking Liquipedia images is
// not allowed, so /api/logo serves them from the bot-warmed on-disk cache).
// Either way a missing/blocked image must degrade to clean initials rather
// than a broken-image icon — same lesson as the tournament crests.
export function ProfileAvatar({
  src,
  name,
  className,
  shape = "circle",
  fit = "cover",
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
  shape?: "circle" | "rounded";
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const safe = safeUrlOrUndefined(src);
  const radius = shape === "circle" ? "rounded-full" : "rounded-2xl";

  if (!safe || failed) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex items-center justify-center bg-muted font-semibold text-muted-foreground",
          radius,
          className,
        )}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- PandaScore CDN or proxied Liquipedia image, validated http(s)
    <img
      src={displayImageUrl(safe)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        "bg-muted",
        radius,
        fit === "contain" ? "object-contain p-1.5" : "object-cover",
        className,
      )}
    />
  );
}
