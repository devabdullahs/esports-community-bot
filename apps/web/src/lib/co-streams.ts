import "server-only";

import { listEwcStreamChannels } from "@bot/db/streamChannels.js";
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
};

const listEwc = listEwcStreamChannels as unknown as (opts?: { activeOnly?: boolean }) => Promise<StreamChannel[]>;
const getStatuses = getStreamStatuses as unknown as (
  pairs: Array<{ platform: string; handle: string }>,
) => Promise<Map<string, StatusRow>>;
const catToSlug = categoryToGameSlug as unknown as (category: string | null) => string | null;
const slugToName = gameName as unknown as (slug: string) => string;

const EMBEDDABLE = new Set<StreamPlatform>(["twitch", "kick"]);

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function groupKey(channel: StreamChannel): string {
  return [
    channel.scope,
    channel.creatorKey || channel.label.toLowerCase(),
    channel.teamKey ?? "",
    channel.matchExternalId ?? "",
    channel.language ?? "",
  ].join(":");
}

function pickEmbedChannel(channels: CoStreamChannel[]): CoStreamChannel | null {
  return (
    channels.find((c) => c.isLive && c.isDefault && EMBEDDABLE.has(c.platform)) ??
    channels.find((c) => c.isLive && EMBEDDABLE.has(c.platform)) ??
    channels.find((c) => c.isDefault && EMBEDDABLE.has(c.platform)) ??
    channels.find((c) => EMBEDDABLE.has(c.platform)) ??
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

export async function getEwcCoStreams(): Promise<CoStream[]> {
  const channels = await listEwc({ activeOnly: true });
  if (!channels.length) return [];

  const statuses = await getStatuses(channels.map((c) => ({ platform: c.platform, handle: c.handle })));

  const merged: CoStreamChannel[] = channels.map((c) => {
    const s = statuses.get(`${c.platform}:${c.handle}`);
    // Relevance gate: a channel streaming an off-topic / non-esports category
    // (e.g. Just Chatting, GTA) is NOT a live co-stream here. Only count it live
    // when the current category maps to a game we track.
    const gameSlug = s?.isLive ? catToSlug(s.category) : null;
    return {
      ...c,
      isLive: Boolean(s?.isLive && gameSlug),
      liveTitle: s?.title ?? null,
      liveGame: gameSlug ? slugToName(gameSlug) : null,
      viewerCount: s?.viewerCount ?? null,
      startedAt: s?.startedAt ?? null,
    };
  });

  return buildCoStreamGroups(merged);
}
