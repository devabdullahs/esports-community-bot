import "server-only";

import { auth } from "@/lib/auth";
import { getDiscordAccountForAuthUser } from "@/lib/auth-database";
import { isDevAuthUser } from "@/lib/dev-auth";
import { DEFAULT_SEASON } from "@/lib/env";
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
  const account = await getDiscordAccountForAuthUser(authUserId);
  if (!account) return null;
  const existing = await getEwcProfileLinkByAuthUser(authUserId);
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
  const account = await getDiscordAccountForAuthUser(authUserId);
  const link = await ensureEwcProfileLink({ authUserId, guildId, season });
  const activeGuildId = guildId || link?.guildId;
  const activeSeason = season || link?.season || DEFAULT_SEASON;
  const stats =
    account && activeGuildId
      ? await getEwcUserProfileStats(activeGuildId, activeSeason, account.accountId, { includeHiddenPicks: true })
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
  const account = await getDiscordAccountForAuthUser(authUserId);
  if (!account) throw new Error("This Discord account is not linked yet.");
  const link = await upsertEwcProfileLink({
    authUserId,
    discordUserId: account.accountId,
    guildId,
    season,
  });

  try {
    const payload = await getEwcRoleConnectionPayload(guildId, season, account.accountId);
    if (isDevAuthUser(authUserId)) {
      await markEwcProfileLinkSynced(account.accountId);
      return {
        link: (await getEwcProfileLinkByDiscordUser(account.accountId)) || link,
        stats: await getEwcUserProfileStats(guildId, season, account.accountId, { includeHiddenPicks: true }),
        payload,
        devBypass: true,
      };
    }

    const accessToken = await accessTokenForAuthUser(authUserId);
    await updateDiscordRoleConnection({
      accessToken,
      clientId: process.env.DISCORD_CLIENT_ID || "",
      payload,
    });
    await markEwcProfileLinkSynced(account.accountId);
    return {
      link: (await getEwcProfileLinkByDiscordUser(account.accountId)) || link,
      stats: await getEwcUserProfileStats(guildId, season, account.accountId, { includeHiddenPicks: true }),
      payload,
    };
  } catch (error) {
    await markEwcProfileLinkError(account.accountId, (error as Error).message);
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
  const link = await getEwcProfileLinkByDiscordUser(discordUserId);
  if (!link) throw new Error("This member has not linked the EWC dashboard.");
  return syncEwcProfileForAuthUser({
    authUserId: link.authUserId,
    guildId: guildId || link.guildId,
    season: season || link.season || DEFAULT_SEASON,
  });
}

export async function unlinkEwcProfileForAuthUser(authUserId: string) {
  const account = await getDiscordAccountForAuthUser(authUserId);
  if (!account) return { deleted: false };

  if (isDevAuthUser(authUserId)) {
    await deleteEwcProfileLink(account.accountId);
    return { deleted: true, devBypass: true };
  }

  try {
    const accessToken = await accessTokenForAuthUser(authUserId);
    await deleteDiscordRoleConnection({
      accessToken,
      clientId: process.env.DISCORD_CLIENT_ID || "",
    });
  } catch (error) {
    console.warn("[ewc-profile-sync] Failed to delete Discord role connection during unlink.", {
      authUserId,
      discordUserId: account.accountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await deleteEwcProfileLink(account.accountId);
  }

  return { deleted: true };
}

export async function unlinkEwcProfileForDiscordUser(discordUserId: string) {
  const link = await getEwcProfileLinkByDiscordUser(discordUserId);
  if (!link) return { deleted: false };
  return unlinkEwcProfileForAuthUser(link.authUserId);
}
