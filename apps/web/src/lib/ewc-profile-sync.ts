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
import { getWeeklyPrediction, listEwcWeeks } from "@bot/db/ewcPredictions.js";
import { effectiveEwcWeekStatus } from "@bot/lib/ewcPredictions.js";
import { selectCurrentOpenEwcWeek } from "@bot/lib/ewcPredictionRounds.js";
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
  const link = await getEwcProfileLinkByAuthUser(authUserId);
  const activeGuildId = guildId || link?.guildId;
  const activeSeason = season || link?.season || DEFAULT_SEASON;
  const [stats, currentRound] =
    account && activeGuildId
      ? await Promise.all([
          getEwcUserProfileStats(activeGuildId, activeSeason, account.accountId, { includeHiddenPicks: true }),
          currentRoundForViewer(activeGuildId, activeSeason, account.accountId),
        ])
      : [null, null];

  return {
    discordUserId: account?.accountId || null,
    link,
    stats,
    currentRound,
  };
}

type HydratedWeek = {
  id: number;
  week_key: string;
  label?: string | null;
  close_at?: number | null;
  games?: Array<{ key?: string; game?: string; event?: string; lockAt?: number | null }>;
};

type WeeklyPrediction = { picks?: Array<string | { gameKey?: string; pick?: string }> } | null;

async function currentRoundForViewer(guildId: string, season: string, discordUserId: string) {
  const now = Math.floor(Date.now() / 1000);
  const weeks = (await listEwcWeeks(guildId, season)) as HydratedWeek[];
  const round = selectCurrentOpenEwcWeek(weeks, now) as HydratedWeek | null;
  if (!round) return null;

  const state = effectiveEwcWeekStatus(round, now) as {
    label: string;
    lockedGames: number;
    openGames: number;
    totalGames: number;
  };
  const prediction = (await getWeeklyPrediction(guildId, round.id, discordUserId)) as WeeklyPrediction;
  const pickedGameKeys = new Set(
    (prediction?.picks ?? [])
      .map((pick) => (pick && typeof pick === "object" ? String(pick.gameKey || "") : ""))
      .filter(Boolean),
  );
  const games = Array.isArray(round.games) ? round.games : [];
  const openGames = games.filter((game) => !game.lockAt || now < game.lockAt);
  const remainingGameKeys = openGames
    .map((game) => String(game.key || ""))
    .filter((key) => key && !pickedGameKeys.has(key));

  return {
    id: round.id,
    weekKey: round.week_key,
    label: round.label || round.week_key,
    status: state.label,
    closesAt: round.close_at ?? null,
    openGames: state.openGames,
    lockedGames: state.lockedGames,
    totalGames: state.totalGames,
    pickedGames: pickedGameKeys.size,
    remainingGameKeys,
    discordUrl: `https://discord.com/channels/${guildId}`,
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
