import "server-only";
import { channelsForTournament } from "@bot/db/streamChannels.js";
import { getStreamStatuses } from "@bot/db/streamChannelStatus.js";
import { normalizeTeamName } from "@bot/lib/render.js";
import { categoryToGameSlug, normalizeGameSlug } from "@bot/lib/games.js";
import type { StreamPlatform } from "@/lib/stream-types";

// Per-match co-stream strip on the tournament-detail "Live now" cards. We pull
// every channel applicable to the tournament's running matches in ONE query,
// join with the poller's live status, then fan back out per match — emitting a
// link only for channels that are currently live AND apply to that match.

export type MatchCoStream = { platform: StreamPlatform; handle: string; label: string; url: string | null };
type Chan = {
  platform: StreamPlatform;
  handle: string;
  label: string;
  url: string | null;
  scope: "game" | "team" | "match" | "ewc";
  teamKey: string | null;
  matchExternalId: string | null;
};

// Pure: does this channel apply to a given match? game/ewc apply to every match
// of the (already game/EWC-filtered) tournament; team applies only when a side's
// normalized name matches; match applies only on the exact external id.
export function coStreamApplies(c: Chan, ctx: { matchExternalId?: string; teamKeys: Set<string> }): boolean {
  return c.scope === "game" || c.scope === "ewc"
    || (c.scope === "team" && c.teamKey != null && ctx.teamKeys.has(c.teamKey))
    || (c.scope === "match" && c.matchExternalId != null && c.matchExternalId === ctx.matchExternalId);
}

const norm = normalizeTeamName as unknown as (s: string | null) => string;
const catToSlug = categoryToGameSlug as unknown as (category: string | null) => string | null;
const normGame = normalizeGameSlug as unknown as (slug: string) => string;
const fetchChannels = channelsForTournament as unknown as (a: { gameSlug?: string | null; teams?: string[]; matchExternalIds?: string[]; includeEwc?: boolean }) => Promise<Chan[]>;
const fetchStatuses = getStreamStatuses as unknown as (pairs: Array<{ platform: string; handle: string }>) => Promise<Map<string, { isLive: boolean; category: string | null }>>;

export async function liveCoStreamsByMatch(
  running: Array<{ id: number; external_id?: string; team_a: string | null; team_b: string | null }>,
  { gameSlug, includeEwc }: { gameSlug: string | null; includeEwc: boolean },
): Promise<Map<number, MatchCoStream[]>> {
  const out = new Map<number, MatchCoStream[]>();
  if (!running.length) return out;
  const teams = running.flatMap((m) => [m.team_a, m.team_b]).filter((t): t is string => Boolean(t));
  const matchExternalIds = running.map((m) => m.external_id).filter((v): v is string => Boolean(v));
  const channels = await fetchChannels({ gameSlug, teams, matchExternalIds, includeEwc });
  if (!channels.length) return out;
  const statuses = await fetchStatuses(channels.map((c) => ({ platform: c.platform, handle: c.handle })));
  // Relevance: only surface a co-streamer who is live AND actually playing this
  // tournament's game (a live channel on an off-topic category — or a different
  // game — does not belong on this match's strip). No game → can't confirm → none.
  const wantedGame = gameSlug ? normGame(gameSlug) : null;
  const live = channels.filter((c) => {
    const s = statuses.get(`${c.platform}:${c.handle}`);
    if (!s?.isLive || !wantedGame) return false;
    const playing = catToSlug(s.category);
    return playing != null && normGame(playing) === wantedGame;
  });
  for (const m of running) {
    const teamKeys = new Set([norm(m.team_a), norm(m.team_b)].filter(Boolean));
    const seen = new Set<string>();
    const links: MatchCoStream[] = [];
    for (const c of live) {
      if (!coStreamApplies(c, { matchExternalId: m.external_id, teamKeys })) continue;
      const key = `${c.platform}:${c.handle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ platform: c.platform, handle: c.handle, label: c.label, url: c.url });
    }
    if (links.length) out.set(m.id, links);
  }
  return out;
}
