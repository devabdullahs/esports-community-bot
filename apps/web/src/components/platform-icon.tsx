import type { ComponentProps } from "react";
import { SiTwitch, SiKick, SiYoutube } from "@icons-pack/react-simple-icons";
import type { StreamPlatform } from "@/lib/stream-types";

// simple-icons has no SOOP brand glyph yet — use a neutral inline fallback that
// matches the brand-icon API (className + currentColor fill).
function SoopIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-2 6 6 4-6 4V8Z" />
    </svg>
  );
}

const ICONS = { twitch: SiTwitch, kick: SiKick, youtube: SiYoutube, soop: SoopIcon } as const;

export function PlatformIcon({ platform, className }: { platform: StreamPlatform; className?: string }) {
  const Icon = ICONS[platform];
  return <Icon className={className} aria-hidden />;
}
