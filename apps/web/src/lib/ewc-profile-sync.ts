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
import { getSettings } from "@bot/db/settings.js";
import { getEwcSeason, getSeasonPrediction, getWeeklyPrediction, listEwcWeeks } from "@bot/db/ewcPredictions.js";
import { effectiveEwcWeekStatus } from "@bot/lib/ewcPredictions.js";
import { categorizeEwcPredictionRounds, predictionRoundCompletion } from "@bot/lib/ewcPredictionRounds.js";
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
  const [stats, actionableRounds, picker] =
    account && activeGuildId
      ? await Promise.all([
          getEwcUserProfileStats(activeGuildId, activeSeason, account.accountId, { includeHiddenPicks: true }),
          actionableRoundsForViewer(activeGuildId, activeSeason, account.accountId),
          privatePickerForViewer(activeGuildId, activeSeason, account.accountId),
        ])
      : [null, [], null];

  return {
    discordUserId: account?.accountId || null,
    link,
    stats,
    // `currentRound` is retained while clients migrate to the full actionable list.
    currentRound: actionableRounds[0] || null,
    actionableRounds,
    picker,
  };
}

type HydratedWeek = {
  id: number;
  week_key: string;
  label?: string | null;
  status?: string | null;
  open_at?: number | null;
  close_at?: number | null;
  score_after?: number | null;
  games?: Array<{ key?: string; game?: string; event?: string; lockAt?: number | null }>;
};

type WeeklyPrediction = { picks?: Array<string | { gameKey?: string; pick?: string }> } | null;

async function projectRoundForViewer(
  round: HydratedWeek,
  guildId: string,
  discordUserId: string,
  now: number,
  discordUrl: string,
) {

  const state = effectiveEwcWeekStatus(round, now) as {
    label: string;
    lockedGames: number;
    openGames: number;
    totalGames: number;
  };
  const prediction = (await getWeeklyPrediction(guildId, round.id, discordUserId)) as WeeklyPrediction;
  const games = Array.isArray(round.games) ? round.games : [];
  const completion = predictionRoundCompletion(round, prediction?.picks ?? [], now);

  return {
    id: round.id,
    weekKey: round.week_key,
    label: round.label || round.week_key,
    status: state.label,
    closesAt: round.close_at ?? null,
    nextLockAt: completion.nextLockAt,
    finalLockAt: completion.finalLockAt,
    openGames: state.openGames,
    lockedGames: state.lockedGames,
    totalGames: state.totalGames,
    pickedGames: completion.pickedGames,
    isComplete: completion.isComplete,
    openUnpickedGames: completion.openUnpickedGames.length,
    openUnpickedGameKeys: completion.openUnpickedGames.map((game) => game.key),
    lockedUnpickedGames: completion.missedGames.length,
    lockedUnpickedGameKeys: completion.missedGames.map((game) => game.key),
    // Compatibility for callers that used the one-round projection before plan 083.
    remainingGameKeys: completion.openUnpickedGames.map((game) => game.key),
    games: games
      .filter((game) => game.key)
      .map((game) => ({
        key: String(game.key),
        game: game.game || String(game.key),
        event: game.event || null,
        lockAt: game.lockAt ?? null,
        state: !game.lockAt || now < game.lockAt ? "open" : "locked",
      })),
    discordUrl,
  };
}

function predictionPickerUrl(guildId: string, settings: Record<string, unknown>) {
  const channelId = String(settings.ewc_predictions_leaderboard_channel_id || "");
  const messageId = String(settings.ewc_predictions_leaderboard_message_id || "");
  if (/^\d{16,20}$/.test(guildId) && /^\d{16,20}$/.test(channelId) && /^\d{16,20}$/.test(messageId)) {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
  }
  return `https://discord.com/channels/${guildId}`;
}

export async function actionableRoundsForViewer(guildId: string, season: string, discordUserId: string) {
  const now = Math.floor(Date.now() / 1000);
  const [weeks, settings] = await Promise.all([
    listEwcWeeks(guildId, season) as Promise<HydratedWeek[]>,
    getSettings(guildId),
  ]);
  const { actionable } = categorizeEwcPredictionRounds(weeks, now) as { actionable: HydratedWeek[] };
  const discordUrl = predictionPickerUrl(guildId, settings);
  return Promise.all(actionable.map((round) => projectRoundForViewer(round, guildId, discordUserId, now, discordUrl)));
}

// This projection is returned only from the authenticated /api/me route. It is
// intentionally separate from the progress projection above so public/status
// callers cannot accidentally inherit a member's selected club.
export async function privatePickerForViewer(guildId: string, season: string, discordUserId: string) {
  const now = Math.floor(Date.now() / 1000);
  const [weeks, seasonRound, seasonPrediction] = await Promise.all([
    listEwcWeeks(guildId, season) as Promise<HydratedWeek[]>,
    getEwcSeason(guildId, season),
    getSeasonPrediction(guildId, season, discordUserId),
  ]);
  const { actionable } = categorizeEwcPredictionRounds(weeks, now) as { actionable: HydratedWeek[] };
  const weekly = await Promise.all(
    actionable.map(async (round) => {
      const prediction = (await getWeeklyPrediction(guildId, round.id, discordUserId)) as WeeklyPrediction;
      const picks = new Map(
        (Array.isArray(prediction?.picks) ? prediction.picks : [])
          .filter((pick): pick is { gameKey?: string; pick?: string } => Boolean(pick && typeof pick === "object"))
          .map((pick) => [String(pick.gameKey || ""), String(pick.pick || "")]),
      );
      return {
        weekKey: round.week_key,
        label: round.label || round.week_key,
        games: (round.games || [])
          .filter((game) => game.key)
          .map((game) => ({
            key: String(game.key),
            game: game.game || String(game.key),
            event: game.event || null,
            lockAt: game.lockAt ?? null,
            state: !game.lockAt || now < game.lockAt ? "open" : "locked",
            pick: picks.get(String(game.key)) || null,
          })),
      };
    }),
  );
  return {
    weekly,
    season: seasonRound
      ? {
          topSize: Number(seasonRound.top_size || 0),
          status: String(seasonRound.status || "open"),
          closeAt: seasonRound.close_at ?? null,
          picks: Array.isArray(seasonPrediction?.picks) ? seasonPrediction.picks.filter((pick: unknown): pick is string => typeof pick === "string") : [],
        }
      : null,
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
