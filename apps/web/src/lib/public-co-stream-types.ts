// The co-stream contract for anonymous viewers. Client components import this, so it must
// stay free of `server-only`, Node built-ins, and database imports.
//
// Every field is written out. These types are deliberately NOT derived from `StreamChannel`
// with `Omit`/`Pick`/intersections: a derived public type inherits whatever an internal
// record gains next, which is exactly how an administrator's Discord ID, internal row IDs,
// audit timestamps, and match/team linkage reached anonymous responses. Adding a public
// field must be a deliberate edit here, to the projector, and to the exact-shape test.

import type { StreamPlatform, StreamScope } from "@/lib/stream-types";

export type PublicCoStreamChannel = {
  platform: StreamPlatform;
  handle: string;
  label: string;
  scope: StreamScope;
  gameSlugs: string[];
  language: string | null;
  isDefault: boolean;
  isLive: boolean;
  liveTitle: string | null;
  liveGame: string | null;
  viewerCount: number | null;
  startedAt: number | null;
  url: string | null;
  videoId: string | null;
};

export type PublicCoStream = {
  /** Opaque, versioned selection token. Never the internal group key. */
  id: string;
  label: string;
  creatorKey: string;
  gameSlugs: string[];
  language: string | null;
  isLive: boolean;
  liveTitle: string | null;
  liveGame: string | null;
  viewerCount: number | null;
  startedAt: number | null;
  channels: PublicCoStreamChannel[];
  embedChannel: PublicCoStreamChannel | null;
};
