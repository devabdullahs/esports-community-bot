import "server-only";

import {
  deleteFollow as _deleteFollow,
  getFollow as _getFollow,
  listFollowsForUser as _listFollows,
  upsertFollow as _upsertFollow,
} from "@bot/db/userFollows.js";
import {
  countUnreadNotifications as _countUnread,
  getNotificationPrefs as _getPrefs,
  listNotificationPageForUser as _listNotificationPage,
  listNotificationsForUser as _listNotifications,
  listUnreadNotificationsForUser as _listUnreadNotifications,
  markAllNotificationsRead as _markAllRead,
  markNotificationRead as _markRead,
  upsertNotificationPrefs as _upsertPrefs,
} from "@bot/db/userNotifications.js";
import { listPersonalizedMatchesForUser as _listPersonalizedMatches } from "@bot/db/userFollows.js";
import { getDiscordAccountForAuthUser } from "@/lib/auth-database";
import { getOptionalSession } from "@/lib/session";

export const FOLLOW_ENTITY_TYPES = ["game", "tournament", "team", "player"] as const;
export type FollowEntityType = (typeof FOLLOW_ENTITY_TYPES)[number];

export type FollowRow = {
  id: number;
  discord_user_id: string;
  entity_type: FollowEntityType;
  entity_key: string;
  entity_label: string;
  entity_ref: string;
  created_at: string;
};

export type NotificationRow = {
  id: number;
  discord_user_id: string;
  type: "match_start" | "match_result";
  match_id: number | null;
  title: string;
  body: string;
  url: string;
  dedupe_key: string;
  read_at: string | null;
  dm_status: "pending" | "sent" | "skipped" | "failed";
  created_at: string;
};

export type NotificationPrefs = {
  discord_user_id: string;
  dm_enabled: number;
  notify_match_start: number;
  notify_match_result: number;
  updated_at: string | null;
};

export type PersonalizedMatchRow = {
  id: number;
  tournamentId: number;
  tournamentName: string;
  game: string;
  teamA: string;
  teamB: string;
  status: "running" | "scheduled";
  scheduledAt: number | null;
};

const upsertFollow = _upsertFollow as unknown as (input: {
  discordUserId: string;
  entityType: FollowEntityType;
  entityKey: string;
  entityLabel?: string;
  entityRef?: string;
}) => Promise<FollowRow | { limited: true }>;
const deleteFollow = _deleteFollow as unknown as (input: {
  discordUserId: string;
  entityType: FollowEntityType;
  entityKey: string;
}) => Promise<number>;
const getFollow = _getFollow as unknown as (input: {
  discordUserId: string;
  entityType: FollowEntityType;
  entityKey: string;
}) => Promise<FollowRow | null>;
const listFollows = _listFollows as unknown as (discordUserId: string) => Promise<FollowRow[]>;
const listNotifications = _listNotifications as unknown as (
  discordUserId: string,
  opts?: { limit?: number; offset?: number },
) => Promise<NotificationRow[]>;
const listNotificationPage = _listNotificationPage as unknown as (
  discordUserId: string,
  opts?: { limit?: number; offset?: number },
) => Promise<{ notifications: NotificationRow[]; nextOffset: number | null }>;
const listUnreadNotifications = _listUnreadNotifications as unknown as (
  discordUserId: string,
  opts?: { limit?: number },
) => Promise<NotificationRow[]>;
const listPersonalizedMatches = _listPersonalizedMatches as unknown as (
  discordUserId: string,
  opts: { nowSec: number; liveLimit?: number; upcomingLimit?: number; upcomingWindowSec?: number },
) => Promise<{ live: PersonalizedMatchRow[]; upcoming: PersonalizedMatchRow[] }>;
const countUnread = _countUnread as unknown as (discordUserId: string) => Promise<number>;
const markRead = _markRead as unknown as (discordUserId: string, id: number) => Promise<number>;
const markAllRead = _markAllRead as unknown as (discordUserId: string) => Promise<number>;
const getPrefs = _getPrefs as unknown as (discordUserId: string) => Promise<NotificationPrefs>;
const upsertPrefs = _upsertPrefs as unknown as (
  discordUserId: string,
  patch: { dmEnabled?: boolean; notifyMatchStart?: boolean; notifyMatchResult?: boolean },
) => Promise<NotificationPrefs>;

export {
  deleteFollow,
  getFollow,
  listFollows,
  upsertFollow,
  listNotificationPage,
  listNotifications,
  listUnreadNotifications,
  listPersonalizedMatches,
  countUnread,
  markRead,
  markAllRead,
  getPrefs,
  upsertPrefs,
};

/** The signed-in viewer's Discord id, or null when logged out / not Discord-linked. */
export async function getViewerDiscordId(): Promise<string | null> {
  let session;
  try {
    session = await getOptionalSession();
  } catch {
    // Outside a request scope (static rendering, tests): treat as signed out.
    return null;
  }
  if (!session) return null;
  const account = await getDiscordAccountForAuthUser(session.user.id);
  return account?.accountId ?? null;
}

/** Follow state for an entity page: null = logged out (render a login link). */
export async function getViewerFollowState(
  entityType: FollowEntityType,
  entityKey: string,
): Promise<{ signedIn: boolean; following: boolean }> {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) return { signedIn: false, following: false };
  const row = await getFollow({ discordUserId, entityType, entityKey });
  return { signedIn: true, following: Boolean(row) };
}

export function isFollowEntityType(value: unknown): value is FollowEntityType {
  return typeof value === "string" && (FOLLOW_ENTITY_TYPES as readonly string[]).includes(value);
}
