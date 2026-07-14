import "server-only";

import { getAllCoStreamsCached } from "@/lib/co-streams";
import { dashboardPublicUrl } from "@/lib/env";
import { actionableRoundsForViewer } from "@/lib/ewc-profile-sync";
import {
  countUnread,
  listFollows,
  listPersonalizedMatches,
  listUnreadNotifications,
  type FollowRow,
  type NotificationRow,
  type PersonalizedMatchRow,
} from "@/lib/follows";
import type { CoStream } from "@/lib/stream-types";

export type TodayMatch = PersonalizedMatchRow & { href: string };

export type TodayNotification = {
  type: "match_start" | "match_result";
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
};

export type TodayRound = {
  label: string;
  status: string;
  closesAt: number | null;
  nextLockAt: number | null;
  openGames: number;
  totalGames: number;
  pickedGames: number;
};

export type TodayCoStream = {
  label: string;
  game: string | null;
  title: string | null;
  viewerCount: number | null;
  startedAt: number | null;
};

export type TodayForYouPayload = {
  liveMatches: TodayMatch[];
  upcomingMatches: TodayMatch[];
  unreadNotifications: TodayNotification[];
  actionableRounds: TodayRound[];
  coStreams: { available: boolean; items: TodayCoStream[] };
  counts: {
    follows: number;
    unreadNotifications: number;
    actionableRounds: number;
  };
  hrefs: {
    following: string;
    notifications: string;
    predictions: string;
    games: string;
    tournaments: string;
    coStreams: string;
  };
};

type ActionableRound = Awaited<ReturnType<typeof actionableRoundsForViewer>>[number];

export type TodayForYouLoaders = {
  matches: typeof listPersonalizedMatches;
  unreadNotifications: typeof listUnreadNotifications;
  unreadCount: typeof countUnread;
  follows: typeof listFollows;
  actionableRounds: typeof actionableRoundsForViewer;
  coStreams: typeof getAllCoStreamsCached;
};

const defaultLoaders: TodayForYouLoaders = {
  matches: listPersonalizedMatches,
  unreadNotifications: listUnreadNotifications,
  unreadCount: countUnread,
  follows: listFollows,
  actionableRounds: actionableRoundsForViewer,
  coStreams: getAllCoStreamsCached,
};

function matchProjection(match: PersonalizedMatchRow): TodayMatch {
  return { ...match, href: `/tournaments/${match.tournamentId}` };
}

function boundedMatchProjection(matches: PersonalizedMatchRow[]): TodayMatch[] {
  const seen = new Set<number>();
  return matches
    .filter((match) => {
      if (seen.has(match.id)) return false;
      seen.add(match.id);
      return true;
    })
    .slice(0, 5)
    .map(matchProjection);
}

function internalHref(value: string): string | null {
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const href = new URL(value);
    const publicOrigin = new URL(dashboardPublicUrl()).origin;
    return href.origin === publicOrigin ? `${href.pathname}${href.search}${href.hash}` : null;
  } catch {
    return null;
  }
}

function notificationProjection(notification: NotificationRow): TodayNotification {
  return {
    type: notification.type,
    title: notification.title,
    body: notification.body,
    href: internalHref(notification.url),
    createdAt: notification.created_at,
  };
}

function roundProjection(round: ActionableRound): TodayRound {
  return {
    label: round.label,
    status: round.status,
    closesAt: round.closesAt,
    nextLockAt: round.nextLockAt,
    openGames: round.openGames,
    totalGames: round.totalGames,
    pickedGames: round.pickedGames,
  };
}

function coStreamProjection(stream: CoStream): TodayCoStream {
  return {
    label: stream.label,
    game: stream.liveGame,
    title: stream.liveTitle,
    viewerCount: stream.viewerCount,
    startedAt: stream.startedAt,
  };
}

function followedGameSlugs(follows: FollowRow[]): Set<string> {
  return new Set(
    follows
      .filter((follow) => follow.entity_type === "game")
      .map((follow) => follow.entity_key.toLowerCase())
      .filter(Boolean),
  );
}

export async function getTodayForViewer(
  discordUserId: string,
  guildId: string,
  season: string,
  nowSec: number,
  loaders: TodayForYouLoaders = defaultLoaders,
): Promise<TodayForYouPayload> {
  const streams = loaders.coStreams()
    .then((items) => ({ available: true as const, items }))
    .catch(() => {
      console.error("[today-for-you] cached co-stream section unavailable");
      return { available: false as const, items: [] as CoStream[] };
    });
  const [matches, unreadNotifications, unreadCount, follows, actionableRounds, coStreamResult] = await Promise.all([
    loaders.matches(discordUserId, { nowSec, liveLimit: 5, upcomingLimit: 5 }),
    loaders.unreadNotifications(discordUserId, { limit: 3 }),
    loaders.unreadCount(discordUserId),
    loaders.follows(discordUserId),
    loaders.actionableRounds(guildId, season, discordUserId),
    streams,
  ]);
  const games = followedGameSlugs(follows);
  const coStreams = coStreamResult.items
    .filter((stream) => stream.isLive && stream.gameSlugs.some((slug) => games.has(slug.toLowerCase())))
    .slice(0, 4)
    .map(coStreamProjection);

  return {
    liveMatches: boundedMatchProjection(matches.live),
    upcomingMatches: boundedMatchProjection(matches.upcoming),
    unreadNotifications: unreadNotifications.slice(0, 3).map(notificationProjection),
    actionableRounds: actionableRounds.map(roundProjection),
    coStreams: { available: coStreamResult.available, items: coStreams },
    counts: {
      follows: follows.length,
      unreadNotifications: unreadCount,
      actionableRounds: actionableRounds.length,
    },
    hrefs: {
      following: "/me?tab=following",
      notifications: "/me?tab=notifications",
      predictions: "/me?tab=predictions",
      games: "/games",
      tournaments: "/tournaments",
      coStreams: "/co-streams",
    },
  };
}
