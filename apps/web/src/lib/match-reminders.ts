import "server-only";

import {
  cancelMatchReminder as _cancelMatchReminder,
  getMatchReminderTarget as _getMatchReminderTarget,
  listActiveReminderMatchIdsForUser as _listActiveReminderMatchIdsForUser,
  upsertMatchReminder as _upsertMatchReminder,
} from "@bot/db/userMatchReminders.js";
import { getViewerDiscordId } from "@/lib/follows";

export type MatchReminderTarget = { id: number; status: "running" | "scheduled" | "finished" };
export type MatchReminderRow = {
  discord_user_id: string;
  match_id: number;
  created_at: string;
  canceled_at: string | null;
};

export const getMatchReminderTarget = _getMatchReminderTarget as unknown as (
  matchId: number,
) => Promise<MatchReminderTarget | null>;
export const upsertMatchReminder = _upsertMatchReminder as unknown as (input: {
  discordUserId: string;
  matchId: number;
}) => Promise<MatchReminderRow>;
export const cancelMatchReminder = _cancelMatchReminder as unknown as (input: {
  discordUserId: string;
  matchId: number;
}) => Promise<MatchReminderRow | null>;
const listActiveReminderMatchIdsForUser = _listActiveReminderMatchIdsForUser as unknown as (
  discordUserId: string,
  matchIds: number[],
) => Promise<number[]>;

export async function getViewerMatchReminderState(matchIds: number[]) {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) return { signedIn: false, reminderMatchIds: [] as number[] };
  const reminderMatchIds = await listActiveReminderMatchIdsForUser(discordUserId, matchIds);
  return { signedIn: true, reminderMatchIds };
}
