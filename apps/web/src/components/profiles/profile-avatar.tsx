"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { displayImageUrl, isProxiableLogoUrl } from "@/lib/logo-url";
import { safeUrlOrUndefined } from "@/lib/safe-url";

const PROXY_RETRY_DELAY_MS = 60_000;
const MAX_PROXY_RETRIES = 5;

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
  focus = "center",
  padded = true,
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
  shape?: "circle" | "rounded";
  fit?: "cover" | "contain";
  focus?: "center" | "top";
  padded?: boolean;
}) {
  const safe = safeUrlOrUndefined(src);
  const [imageState, setImageState] = useState({
    src: safe ?? null,
    failed: false,
    retryToken: 0,
    retryCount: 0,
  });
  const currentImageState =
    imageState.src === (safe ?? null)
      ? imageState
      : { src: safe ?? null, failed: false, retryToken: 0, retryCount: 0 };
  const radius = shape === "circle" ? "rounded-full" : "rounded-2xl";
  const isProxyImage = safe ? isProxiableLogoUrl(safe) : false;
  const renderedSrc = useMemo(() => {
    if (!safe) return null;
    const url = displayImageUrl(safe);
    if (!isProxyImage || currentImageState.retryToken <= 0) return url;
    return `${url}${url.includes("?") ? "&" : "?"}retry=${currentImageState.retryToken}`;
  }, [currentImageState.retryToken, isProxyImage, safe]);

  useEffect(() => {
    if (
      !safe ||
      !currentImageState.failed ||
      !isProxyImage ||
      currentImageState.retryCount >= MAX_PROXY_RETRIES
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setImageState((state) => {
        const active =
          state.src === safe
            ? state
            : { src: safe, failed: true, retryToken: 0, retryCount: 0 };
        return {
          ...active,
          failed: false,
          retryCount: active.retryCount + 1,
          retryToken: Date.now(),
        };
      });
    }, PROXY_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [currentImageState.failed, currentImageState.retryCount, isProxyImage, safe]);

  if (!safe || !renderedSrc || currentImageState.failed) {
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
      src={renderedSrc}
      alt=""
      loading="lazy"
      onError={() =>
        setImageState((state) => {
          const active =
            state.src === safe
              ? state
              : { src: safe, failed: false, retryToken: 0, retryCount: 0 };
          return { ...active, failed: true };
        })
      }
      className={cn(
        "bg-muted",
        radius,
        fit === "contain" ? (padded ? "object-contain p-1.5" : "object-contain") : "object-cover",
        fit === "cover" && focus === "top" ? "object-top" : "object-center",
        className,
      )}
    />
  );
}
