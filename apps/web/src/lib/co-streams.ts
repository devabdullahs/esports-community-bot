import "server-only";

import { listEwcStreamChannels } from "@bot/db/streamChannels.js";
import { getStreamStatuses } from "@bot/db/streamChannelStatus.js";
import type { CoStream, CoStreamChannel, StreamChannel, StreamPlatform } from "@/lib/stream-types";

export type { CoStream };

// Join the official EWC co-stream channels with their current live status (written
// by the bot's stream-status poller) into a single view model for the page.

type StatusRow = {
  isLive: boolean;
  title: string | null;
  viewerCount: number | null;
  startedAt: number | null;
};

const listEwc = listEwcStreamChannels as unknown as (opts?: { activeOnly?: boolean }) => Promise<StreamChannel[]>;
const getStatuses = getStreamStatuses as unknown as (
  pairs: Array<{ platform: string; handle: string }>,
) => Promise<Map<string, StatusRow>>;

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

export async function getEwcCoStreams(): Promise<CoStream[]> {
  const channels = await listEwc({ activeOnly: true });
  if (!channels.length) return [];

  const statuses = await getStatuses(channels.map((c) => ({ platform: c.platform, handle: c.handle })));

  const merged: CoStreamChannel[] = channels.map((c) => {
    const s = statuses.get(`${c.platform}:${c.handle}`);
    return {
      ...c,
      isLive: Boolean(s?.isLive),
      liveTitle: s?.title ?? null,
      viewerCount: s?.viewerCount ?? null,
      startedAt: s?.startedAt ?? null,
    };
  });

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
      viewerCount: liveChannels.reduce((sum, c) => sum + (c.viewerCount ?? 0), 0) || null,
      startedAt: liveChannels.map((c) => c.startedAt).filter((v): v is number => typeof v === "number").sort()[0] ?? null,
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
