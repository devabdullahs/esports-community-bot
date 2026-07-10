import "server-only";

import { revalidateTag } from "next/cache";
import { getEwcProfileLinkByAuthUser } from "@bot/db/ewcProfileLinks.js";
import {
  submitSeasonSlot,
  submitWeeklyGamePick,
  swapSeasonPicks,
} from "@bot/lib/ewcPredictionWrites.js";
import type { CommunityMember } from "@/lib/community";
import { DEFAULT_SEASON } from "@/lib/env";
import { actionableRoundsForViewer, syncEwcProfileForAuthUser } from "@/lib/ewc-profile-sync";
import { resolveDefaultGuildId } from "@/lib/guild";

type WriteResult = {
  ok: boolean;
  code: string;
  message: string;
  firstPick?: boolean;
  completion?: unknown[];
};

type Writer = {
  weekly: typeof submitWeeklyGamePick;
  seasonSlot: typeof submitSeasonSlot;
  seasonSwap: typeof swapSeasonPicks;
};

type CompletionLoader = typeof actionableRoundsForViewer;
type RoleSync = typeof syncEwcProfileForAuthUser;

const defaultWriter: Writer = {
  weekly: submitWeeklyGamePick,
  seasonSlot: submitSeasonSlot,
  seasonSwap: swapSeasonPicks,
};

function adapterError(code: string, message: string): WriteResult {
  return { ok: false, code, message };
}

function safeText(value: unknown, maxLength = 128): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function opaqueKey(value: unknown): string | null {
  const text = safeText(value, 64);
  return text && /^[a-z0-9][a-z0-9_-]*$/i.test(text) ? text : null;
}

async function linkedPredictionContext(member: CommunityMember) {
  const link = await getEwcProfileLinkByAuthUser(member.authUserId);
  if (!link || link.discordUserId !== member.discordUserId) return null;

  // This bot is intentionally single-guild. A stale/cross-guild link must not
  // let a browser choose its own prediction namespace.
  const configuredGuildId = await resolveDefaultGuildId();
  if (!configuredGuildId || link.guildId !== configuredGuildId) return null;
  return {
    guildId: configuredGuildId,
    season: link.season || DEFAULT_SEASON,
    discordUserId: member.discordUserId,
  };
}

function invalidatePredictionCaches() {
  try {
    revalidateTag("ewc-predictions", "default");
    revalidateTag("ewc-public-leaderboard", "default");
  } catch {
    // Cache refresh is advisory after the database commit. A later request or
    // scheduled refresh will recover without misreporting the saved pick.
  }
}

export function mapPredictionWriteStatus(result: WriteResult): number {
  if (result.ok) return 200;
  if (result.code === "round_not_found" || result.code === "game_not_found") return 404;
  if (["locked", "round_closed", "not_open", "slot_locked", "duplicate_pick"].includes(result.code)) return 409;
  if (result.code === "resolution_unavailable") return 503;
  return 400;
}

async function completionAfterWrite(
  context: { guildId: string; season: string; discordUserId: string },
  loader: CompletionLoader,
) {
  try {
    return await loader(context.guildId, context.season, context.discordUserId);
  } catch {
    return [];
  }
}

async function syncFirstWeeklyPick(
  member: CommunityMember,
  context: { guildId: string; season: string },
  firstPick: boolean | undefined,
  roleSync: RoleSync,
) {
  if (!firstPick) return;
  try {
    await roleSync({ authUserId: member.authUserId, guildId: context.guildId, season: context.season });
  } catch {
    // The prediction is already committed. Linked-role refresh is best-effort
    // and must not turn a successful save into a client-visible failure.
  }
}

export async function submitWebWeeklyPick({
  member,
  body,
  submittedAt,
  writer = defaultWriter,
  completionLoader = actionableRoundsForViewer,
  roleSync = syncEwcProfileForAuthUser,
}: {
  member: CommunityMember;
  body: { weekKey?: unknown; gameKey?: unknown; pick?: unknown };
  submittedAt: number;
  writer?: Writer;
  completionLoader?: CompletionLoader;
  roleSync?: RoleSync;
}) {
  const weekKey = opaqueKey(body.weekKey);
  const gameKey = opaqueKey(body.gameKey);
  const rawPick = safeText(body.pick);
  if (!weekKey || !gameKey || !rawPick) return adapterError("invalid_input", "Enter a valid round, game, and club.");

  const context = await linkedPredictionContext(member);
  if (!context) return adapterError("profile_required", "Link your verified Discord account to an active prediction profile first.");

  let result: WriteResult;
  try {
    result = await writer.weekly({
      guildId: context.guildId,
      season: context.season,
      userId: context.discordUserId,
      weekKey,
      gameKey,
      rawPick,
      submittedAt,
    });
  } catch {
    return adapterError("resolution_unavailable", "Prediction validation is temporarily unavailable. Please try again shortly.");
  }
  if (!result.ok) return result;
  invalidatePredictionCaches();
  const completion = await completionAfterWrite(context, completionLoader);
  await syncFirstWeeklyPick(member, context, result.firstPick, roleSync);
  return { ...result, completion };
}

export async function submitWebSeasonPick({
  member,
  body,
  submittedAt,
  writer = defaultWriter,
  completionLoader = actionableRoundsForViewer,
}: {
  member: CommunityMember;
  body: { action?: unknown; index?: unknown; a?: unknown; b?: unknown; pick?: unknown };
  submittedAt: number;
  writer?: Writer;
  completionLoader?: CompletionLoader;
}) {
  const context = await linkedPredictionContext(member);
  if (!context) return adapterError("profile_required", "Link your verified Discord account to an active prediction profile first.");

  const action = body.action;
  const integer = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
  try {
    if (action === "set") {
      const index = integer(body.index);
      const rawPick = safeText(body.pick);
      if (index === null || !rawPick) return adapterError("invalid_input", "Enter a valid season rank and club.");
      const result = await writer.seasonSlot({
        guildId: context.guildId,
        season: context.season,
        userId: context.discordUserId,
        index,
        rawPick,
        submittedAt,
      });
      if (!result.ok) return result;
      invalidatePredictionCaches();
      return { ...result, completion: await completionAfterWrite(context, completionLoader) };
    }
    if (action === "swap") {
      const a = integer(body.a);
      const b = integer(body.b);
      if (a === null || b === null || a === b) return adapterError("invalid_input", "Choose two different filled season ranks.");
      const result = await writer.seasonSwap({
        guildId: context.guildId,
        season: context.season,
        userId: context.discordUserId,
        a,
        b,
        submittedAt,
      });
      if (!result.ok) return result;
      invalidatePredictionCaches();
      return { ...result, completion: await completionAfterWrite(context, completionLoader) };
    }
  } catch {
    return adapterError("resolution_unavailable", "Prediction validation is temporarily unavailable. Please try again shortly.");
  }
  return adapterError("invalid_input", "Choose a supported season prediction action.");
}
