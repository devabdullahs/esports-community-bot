import "server-only";

import { listEwcStreamChannels } from "@bot/db/streamChannels.js";
import { getStreamStatuses } from "@bot/db/streamChannelStatus.js";
import type { CoStream, StreamChannel } from "@/lib/stream-types";

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

export async function getEwcCoStreams(): Promise<CoStream[]> {
  const channels = await listEwc({ activeOnly: true });
  if (!channels.length) return [];

  const statuses = await getStatuses(channels.map((c) => ({ platform: c.platform, handle: c.handle })));

  const merged: CoStream[] = channels.map((c) => {
    const s = statuses.get(`${c.platform}:${c.handle}`);
    return {
      ...c,
      isLive: Boolean(s?.isLive),
      liveTitle: s?.title ?? null,
      viewerCount: s?.viewerCount ?? null,
      startedAt: s?.startedAt ?? null,
    };
  });

  // Live first, then by viewers desc, then by the admin sort order.
  merged.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    if (a.isLive && b.isLive) return (b.viewerCount ?? 0) - (a.viewerCount ?? 0);
    return a.sortOrder - b.sortOrder;
  });

  return merged;
}
