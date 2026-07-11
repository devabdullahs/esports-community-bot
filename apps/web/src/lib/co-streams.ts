import "server-only";

import { unstable_cache } from "next/cache";
import { listEwcStreamChannels, listStreamChannels } from "@bot/db/streamChannels.js";
import { getStreamStatuses } from "@bot/db/streamChannelStatus.js";
import { categoryToGameSlug, gameName } from "@bot/lib/games.js";
import type { CoStream, CoStreamChannel, StreamChannel, StreamPlatform } from "@/lib/stream-types";

export type { CoStream };

// Join the official EWC co-stream channels with their current live status (written
// by the bot's stream-status poller) into a single view model for the page.

type StatusRow = {
  isLive: boolean;
  title: string | null;
  viewerCount: number | null;
  startedAt: number | null;
  category: string | null;
  videoId: string | null;
};

const listEwc = listEwcStreamChannels as unknown as (opts?: { activeOnly?: boolean }) => Promise<StreamChannel[]>;
const listAll = listStreamChannels as unknown as (opts?: { activeOnly?: boolean }) => Promise<StreamChannel[]>;
const getStatuses = getStreamStatuses as unknown as (
  pairs: Array<{ platform: string; handle: string }>,
) => Promise<Map<string, StatusRow>>;
const catToSlug = categoryToGameSlug as unknown as (category: string | null) => string | null;
const slugToName = gameName as unknown as (slug: string) => string;

const EMBEDDABLE = new Set<StreamPlatform>(["twitch", "kick"]);

// YouTube is embeddable only once the poller has resolved the LIVE video id
// (the iframe needs youtube.com/embed/<videoId>; a channel URL cannot embed).
function canEmbed(channel: CoStreamChannel): boolean {
  if (channel.platform === "youtube") return Boolean(channel.videoId);
  return EMBEDDABLE.has(channel.platform);
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function groupKey(channel: StreamChannel): string {
  return [
    channel.scope,
    channel.creatorKey || channel.label.toLowerCase(),
    channel.teamKey ?? "",
    channel.matchExternalId ?? "",
  ].join(":");
}

function pickEmbedChannel(channels: CoStreamChannel[]): CoStreamChannel | null {
  return (
    channels.find((c) => c.isLive && c.isDefault && canEmbed(c)) ??
    channels.find((c) => c.isLive && canEmbed(c)) ??
    channels.find((c) => c.isDefault && canEmbed(c)) ??
    channels.find((c) => canEmbed(c)) ??
    null
  );
}

// Pure grouping: collapse a creator's per-platform channels into one CoStream per
// group, compute the headline live status, and sort live-first. Exported so it can
// be tested without a DB.
export function buildCoStreamGroups(merged: CoStreamChannel[]): CoStream[] {
  const groups = new Map<string, CoStreamChannel[]>();
  for (const channel of merged) {
    const key = groupKey(channel);
    groups.set(key, [...(groups.get(key) ?? []), channel]);
  }

  const out: CoStream[] = [...groups.entries()].map(([id, group]) => {
    group.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
    const embedChannel = pickEmbedChannel(group);
    const liveChannels = group.filter((c) => c.isLive);
    // Headline viewers: the embed channel's count if it's live, otherwise the max
    // across live platforms — never the sum (one creator, one audience).
    const headlineViewers =
      (embedChannel?.isLive ? embedChannel.viewerCount : null) ??
      (liveChannels.length ? Math.max(...liveChannels.map((c) => c.viewerCount ?? 0)) : null);
    return {
      id,
      label: group[0]?.label ?? "Co-streamer",
      creatorKey: group[0]?.creatorKey ?? id,
      gameSlugs: uniq(group.flatMap((c) => c.gameSlugs ?? (c.gameSlug ? [c.gameSlug] : []))),
      language: group.find((c) => c.language)?.language ?? null,
      channels: group,
      embedChannel,
      isLive: liveChannels.length > 0,
      liveTitle: liveChannels.find((c) => c.liveTitle)?.liveTitle ?? null,
      liveGame: (embedChannel?.isLive ? embedChannel.liveGame : null) ?? liveChannels.find((c) => c.liveGame)?.liveGame ?? null,
      viewerCount: headlineViewers,
      startedAt: liveChannels.map((c) => c.startedAt).filter((v): v is number => typeof v === "number").sort((a, b) => a - b)[0] ?? null,
      sortOrder: Math.min(...group.map((c) => c.sortOrder)),
    };
  });

  // Live first, then by viewers desc, then by the admin sort order.
  out.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    if (a.isLive && b.isLive) return (b.viewerCount ?? 0) - (a.viewerCount ?? 0);
    return a.sortOrder - b.sortOrder;
  });

  return out;
}

async function mergeWithStatus(channels: StreamChannel[]): Promise<CoStream[]> {
  if (!channels.length) return [];
  const statuses = await getStatuses(channels.map((c) => ({ platform: c.platform, handle: c.handle })));

  const merged: CoStreamChannel[] = channels.map((c) => {
    const s = statuses.get(`${c.platform}:${c.handle}`);
    // Relevance gate: a channel streaming an off-topic / non-esports category
    // (e.g. Just Chatting, GTA) is NOT a live co-stream here. Only gate when the
    // platform REPORTS a category (Twitch/Kick always do): YouTube's page probe
    // has none, so an unknown category passes rather than hiding a live stream.
    const gameSlug = s?.isLive ? catToSlug(s.category) : null;
    const relevant = Boolean(s?.isLive && (gameSlug || s?.category == null));
    return {
      ...c,
      isLive: relevant,
      liveTitle: s?.title ?? null,
      liveGame: gameSlug ? slugToName(gameSlug) : null,
      viewerCount: s?.viewerCount ?? null,
      startedAt: s?.startedAt ?? null,
      videoId: s?.videoId ?? null,
    };
  });

  return buildCoStreamGroups(merged);
}

export async function getEwcCoStreams(): Promise<CoStream[]> {
  return mergeWithStatus(await listEwc({ activeOnly: true }));
}

// EVERY active co-stream channel (all scopes: ewc + game + team + match) — the
// site-wide surfaces (co-streams page, homepage strip, nav badge) read this.
export async function getAllCoStreams(): Promise<CoStream[]> {
  return mergeWithStatus(await listAll({ activeOnly: true }));
}

// The /co-streams page and the /api/co-streams poll both read this. Live status is
// written by the bot poller (~60s), so cache with a short time-based revalidate
// (not a tag) — one DB read per 30s regardless of viewer/poll count.
export const getEwcCoStreamsCached = unstable_cache(
  async () => getEwcCoStreams(),
  ["ewc-co-streams"],
  { revalidate: 30 },
);

export const getAllCoStreamsCached = unstable_cache(
  async () => getAllCoStreams(),
  ["all-co-streams"],
  { revalidate: 30 },
);

// Cheap header signal: how many co-stream groups are live right now.
export async function countLiveCoStreams(): Promise<number> {
  const streams = await getAllCoStreamsCached();
  return streams.filter((s) => s.isLive).length;
}
