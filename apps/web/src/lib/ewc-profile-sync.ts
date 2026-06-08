import "server-only";

import { auth } from "@/lib/auth";
import { DEFAULT_SEASON } from "@/lib/env";
import { db } from "@bot/db/connection.js";
import {
  deleteEwcProfileLink,
  getEwcProfileLinkByAuthUser,
  getEwcProfileLinkByDiscordUser,
  markEwcProfileLinkError,
  markEwcProfileLinkSynced,
  upsertEwcProfileLink,
} from "@bot/db/ewcProfileLinks.js";
import {
  getEwcRoleConnectionPayload,
  getEwcUserProfileStats,
} from "@bot/lib/ewcProfileStats.js";
import {
  deleteDiscordRoleConnection,
  updateDiscordRoleConnection,
} from "@bot/lib/discordRoleConnection.js";

type DiscordAccount = {
  accountId: string;
  userId: string;
};

function safeAccountQuery<T>(fn: () => T) {
  try {
    return fn();
  } catch (error) {
    if (/no such table: account/i.test(String((error as Error).message))) return null;
    throw error;
  }
}

export function getDiscordAccountForAuthUser(authUserId: string): DiscordAccount | null {
  return safeAccountQuery(() =>
    db
      .prepare(
        `SELECT accountId, userId
         FROM account
         WHERE userId = ? AND providerId = 'discord'
         ORDER BY updatedAt DESC
         LIMIT 1`,
      )
      .get(authUserId) as DiscordAccount | undefined,
  ) || null;
}

async function accessTokenForAuthUser(authUserId: string) {
  const token = await auth.api.getAccessToken({
    body: {
      providerId: "discord",
      userId: authUserId,
    },
  });
  if (!token.accessToken) throw new Error("Discord access token is unavailable.");
  return token.accessToken;
}

export async function ensureEwcProfileLink({
  authUserId,
  guildId,
  season = DEFAULT_SEASON,
}: {
  authUserId: string;
  guildId?: string | null;
  season?: string | null;
}) {
  const account = getDiscordAccountForAuthUser(authUserId);
  if (!account) return null;
  const existing = getEwcProfileLinkByAuthUser(authUserId);
  const nextGuildId = guildId || existing?.guildId;
  if (!nextGuildId) return existing;
  return upsertEwcProfileLink({
    authUserId,
    discordUserId: account.accountId,
    guildId: nextGuildId,
    season: season || existing?.season || DEFAULT_SEASON,
  });
}

export async function getEwcMePayload({
  authUserId,
  guildId,
  season,
}: {
  authUserId: string;
  guildId?: string | null;
  season?: string | null;
}) {
  const account = getDiscordAccountForAuthUser(authUserId);
  const link = await ensureEwcProfileLink({ authUserId, guildId, season });
  const activeGuildId = guildId || link?.guildId;
  const activeSeason = season || link?.season || DEFAULT_SEASON;
  const stats =
    account && activeGuildId
      ? getEwcUserProfileStats(activeGuildId, activeSeason, account.accountId)
      : null;

  return {
    discordUserId: account?.accountId || null,
    link,
    stats,
  };
}

export async function syncEwcProfileForAuthUser({
  authUserId,
  guildId,
  season = DEFAULT_SEASON,
}: {
  authUserId: string;
  guildId: string;
  season?: string;
}) {
  const account = getDiscordAccountForAuthUser(authUserId);
  if (!account) throw new Error("This Discord account is not linked yet.");
  const link = upsertEwcProfileLink({
    authUserId,
    discordUserId: account.accountId,
    guildId,
    season,
  });

  try {
    const accessToken = await accessTokenForAuthUser(authUserId);
    const payload = getEwcRoleConnectionPayload(guildId, season, account.accountId);
    await updateDiscordRoleConnection({
      accessToken,
      clientId: process.env.DISCORD_CLIENT_ID || "",
      payload,
    });
    markEwcProfileLinkSynced(account.accountId);
    return {
      link: getEwcProfileLinkByDiscordUser(account.accountId) || link,
      stats: getEwcUserProfileStats(guildId, season, account.accountId),
      payload,
    };
  } catch (error) {
    markEwcProfileLinkError(account.accountId, (error as Error).message);
    throw error;
  }
}

export async function syncEwcProfileForDiscordUser({
  discordUserId,
  guildId,
  season,
}: {
  discordUserId: string;
  guildId?: string | null;
  season?: string | null;
}) {
  const link = getEwcProfileLinkByDiscordUser(discordUserId);
  if (!link) throw new Error("This member has not linked the EWC dashboard.");
  return syncEwcProfileForAuthUser({
    authUserId: link.authUserId,
    guildId: guildId || link.guildId,
    season: season || link.season || DEFAULT_SEASON,
  });
}

export async function unlinkEwcProfileForAuthUser(authUserId: string) {
  const account = getDiscordAccountForAuthUser(authUserId);
  if (!account) return { deleted: false };

  try {
    const accessToken = await accessTokenForAuthUser(authUserId);
    await deleteDiscordRoleConnection({
      accessToken,
      clientId: process.env.DISCORD_CLIENT_ID || "",
    });
  } finally {
    deleteEwcProfileLink(account.accountId);
  }

  return { deleted: true };
}

export async function unlinkEwcProfileForDiscordUser(discordUserId: string) {
  const link = getEwcProfileLinkByDiscordUser(discordUserId);
  if (!link) return { deleted: false };
  return unlinkEwcProfileForAuthUser(link.authUserId);
}
