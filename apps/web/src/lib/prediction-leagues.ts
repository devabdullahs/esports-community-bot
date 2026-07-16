import "server-only";

import {
  archivePredictionLeague as _archive,
  createPredictionLeague as _create,
  getPredictionLeagueForMember as _get,
  joinPredictionLeague as _join,
  leavePredictionLeague as _leave,
  listPredictionLeaguesForMember as _list,
  predictionLeagueLeaderboard as _leaderboard,
} from "@bot/db/ewcPredictionLeagues.js";
import { getEwcProfileLinkByAuthUser, publicEwcProfileIdentitiesByDiscordUserIds } from "@bot/db/ewcProfileLinks.js";
import type { CommunityMember } from "@/lib/community";
import { DEFAULT_SEASON } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";

type LeagueRow = {
  id: string;
  guildId: string;
  season: string;
  name: string;
  ownerUserId: string;
  memberCount: number;
  isOwner: boolean;
  inviteCode: string | null;
  createdAt: string;
};

type LeaderboardRow = { userId: string; score: number; rank: number };

export type PredictionLeague = Omit<LeagueRow, "guildId" | "season" | "ownerUserId">;

export type PredictionLeagueLeaderboardRow = {
  rank: number;
  score: number;
  displayName: string;
};

export type PredictionLeagueContext = {
  guildId: string;
  season: string;
  discordUserId: string;
};

const create = _create as unknown as (input: {
  guildId: string;
  season: string;
  ownerUserId: string;
  name: string;
}) => Promise<{ created: boolean; reason: string | null; league: LeagueRow | null }>;
const list = _list as unknown as (input: { guildId: string; season: string; userId: string }) => Promise<LeagueRow[]>;
const get = _get as unknown as (input: { guildId: string; season: string; userId: string; leagueId: string }) => Promise<LeagueRow | null>;
const join = _join as unknown as (input: { guildId: string; season: string; userId: string; inviteCode: string }) => Promise<{
  joined: boolean;
  reason: string | null;
  league: LeagueRow | null;
}>;
const leave = _leave as unknown as (input: { guildId: string; season: string; userId: string; leagueId: string }) => Promise<{ left: boolean; reason: string | null }>;
const archive = _archive as unknown as (input: PredictionLeagueContext & { ownerUserId: string; leagueId: string }) => Promise<boolean>;
const leaderboard = _leaderboard as unknown as (input: {
  guildId: string;
  season: string;
  leagueId: string;
}) => Promise<LeaderboardRow[]>;

function serializeLeague(league: LeagueRow): PredictionLeague {
  return {
    id: league.id,
    name: league.name,
    memberCount: league.memberCount,
    isOwner: league.isOwner,
    inviteCode: league.inviteCode,
    createdAt: league.createdAt,
  };
}

export function isPredictionLeagueId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function linkedPredictionLeagueContext(member: CommunityMember): Promise<PredictionLeagueContext | null> {
  const link = await getEwcProfileLinkByAuthUser(member.authUserId);
  if (!link || link.discordUserId !== member.discordUserId) return null;

  const configuredGuildId = await resolveDefaultGuildId();
  if (!configuredGuildId || link.guildId !== configuredGuildId) return null;
  return {
    guildId: configuredGuildId,
    season: link.season || DEFAULT_SEASON,
    discordUserId: member.discordUserId,
  };
}

export async function listViewerPredictionLeagues(context: PredictionLeagueContext): Promise<PredictionLeague[]> {
  const leagues = await list({ ...context, userId: context.discordUserId });
  return leagues.map(serializeLeague);
}

export async function createViewerPredictionLeague(context: PredictionLeagueContext, name: string) {
  const result = await create({ ...context, ownerUserId: context.discordUserId, name });
  return { ...result, league: result.league ? serializeLeague(result.league) : null };
}

export async function joinViewerPredictionLeague(context: PredictionLeagueContext, inviteCode: string) {
  const result = await join({ ...context, userId: context.discordUserId, inviteCode });
  return { ...result, league: result.league ? serializeLeague(result.league) : null };
}

export async function leaveViewerPredictionLeague(context: PredictionLeagueContext, leagueId: string) {
  return leave({ ...context, userId: context.discordUserId, leagueId });
}

export async function archiveViewerPredictionLeague(context: PredictionLeagueContext, leagueId: string) {
  return archive({ ...context, ownerUserId: context.discordUserId, leagueId });
}

export async function viewerPredictionLeagueDetail(context: PredictionLeagueContext, leagueId: string) {
  const league = await get({ ...context, userId: context.discordUserId, leagueId });
  if (!league) return null;

  const rows = await leaderboard({ ...context, leagueId });
  const identities = await publicEwcProfileIdentitiesByDiscordUserIds(rows.map((row) => row.userId));
  return {
    league: serializeLeague(league),
    leaderboard: rows.map((row) => ({
      rank: row.rank,
      score: row.score,
      displayName: identities.get(row.userId)?.displayName || "Member",
    })),
  };
}
