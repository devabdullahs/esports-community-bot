// Shared stream-channel types + constants. NO "server-only" here so client
// components can import the enums/types; the server wrapper (stream-channels.ts)
// re-exports these alongside the DB-backed functions.

export const STREAM_PLATFORMS = ["twitch", "kick", "youtube", "soop"] as const;
export type StreamPlatform = (typeof STREAM_PLATFORMS)[number];

// Platforms an admin can choose as the preferred embedded player. YouTube embeds
// only while live, after the poller resolves the current video id.
export const STREAM_DEFAULT_EMBED_PLATFORMS = ["twitch", "kick", "youtube"] as const satisfies readonly StreamPlatform[];

export const STREAM_SCOPES = ["game", "team", "match", "ewc"] as const;
export type StreamScope = (typeof STREAM_SCOPES)[number];

export type StreamChannel = {
  id: number;
  platform: StreamPlatform;
  handle: string;
  label: string;
  scope: StreamScope;
  creatorKey: string;
  gameSlug: string | null;
  gameSlugs: string[];
  teamKey: string | null;
  matchExternalId: string | null;
  language: string | null;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
  url: string | null;
};

export type CreateStreamChannelInput = {
  platform: StreamPlatform;
  handle: string;
  label?: string;
  scope: StreamScope;
  gameSlug?: string;
  gameSlugs?: string[];
  creatorKey?: string;
  team?: string;
  matchExternalId?: string;
  language?: string;
  isDefault?: boolean;
  addedBy?: string | null;
};

export type UpdateStreamChannelInput = {
  label?: string;
  language?: string;
  sortOrder?: number;
  active?: boolean;
  gameSlugs?: string[];
  creatorKey?: string;
  isDefault?: boolean;
};

// A channel joined with its current live status (for the public co-streams page).
// `isLive` is RELEVANCE-aware: a channel streaming an off-topic / non-esports
// category counts as not-live here. `liveGame` is the display name of what they're
// actually playing (null when offline or off-topic).
export type CoStreamChannel = StreamChannel & {
  isLive: boolean;
  liveTitle: string | null;
  liveGame: string | null;
  viewerCount: number | null;
  startedAt: number | null;
  // Live VIDEO id (YouTube only) — required to embed; null while offline.
  videoId: string | null;
};

export type CoStream = {
  id: string;
  label: string;
  creatorKey: string;
  gameSlugs: string[];
  language: string | null;
  channels: CoStreamChannel[];
  embedChannel: CoStreamChannel | null;
  isLive: boolean;
  liveTitle: string | null;
  liveGame: string | null;
  viewerCount: number | null;
  startedAt: number | null;
  sortOrder: number;
};
