import "server-only";

import {
  getEwcPredictionAutomationHealth,
  listEwcPredictionOperations,
} from "@bot/db/ewcPredictionOperations.js";
import {
  getEwcSeason,
  listEwcPredictionRemindersForWeek,
  listEwcWeeks,
  listWeeklyPredictions,
} from "@bot/db/ewcPredictions.js";
import { effectiveEwcWeekStatus } from "@bot/lib/ewcPredictions.js";
import { DEFAULT_SEASON } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";

type RawWeek = {
  id: number;
  week_key: string;
  label?: string | null;
  status: string;
  open_at?: number | null;
  close_at?: number | null;
  scored_at?: string | null;
  baseline?: unknown[] | null;
  final?: unknown[] | null;
  results?: unknown[] | null;
  games?: Array<{ key?: string; lockAt?: number | null }> | null;
};

type RawPrediction = { score?: number | null };

export type AdminPredictionRound = {
  weekKey: string;
  label: string;
  effectiveStatus: string;
  status: string;
  openAt: number | null;
  closeAt: number | null;
  scoredAt: string | null;
  gameCount: number;
  participantCount: number;
  scoredCount: number;
  baselineAvailable: boolean;
  finalAvailable: boolean;
  resultsAvailable: boolean;
  reminders: { sent: number; claimed: number; attempts: number };
};

export type AdminPredictionOperationsModel = {
  guildId: string | null;
  season: string;
  seasonRound: { status: string; scoredAt: string | null; finalAvailable: boolean } | null;
  rounds: AdminPredictionRound[];
  operations: Array<{
    id: string;
    operation: string;
    status: string;
    requestedAt: string;
    completedAt: string | null;
    attempts: number;
    result: unknown;
    error: string | null;
    targetWeekKey: string | null;
  }>;
  health: { lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null } | null;
};

function reminderSummary(rows: Array<{ sent_at?: string | null; claim_expires_at?: number | null; attempts?: number }>) {
  return rows.reduce(
    (summary, row) => ({
      sent: summary.sent + (row.sent_at ? 1 : 0),
      claimed: summary.claimed + (!row.sent_at && row.claim_expires_at ? 1 : 0),
      attempts: summary.attempts + Number(row.attempts || 0),
    }),
    { sent: 0, claimed: 0, attempts: 0 },
  );
}

export async function getAdminPredictionOperationsModel({ season = DEFAULT_SEASON } = {}): Promise<AdminPredictionOperationsModel> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) {
    return { guildId: null, season, seasonRound: null, rounds: [], operations: [], health: null };
  }
  const [weeks, seasonRound, operations, health] = await Promise.all([
    listEwcWeeks(guildId, season) as Promise<RawWeek[]>,
    getEwcSeason(guildId, season) as Promise<{ status: string; scored_at?: string | null; final?: unknown[] | null } | null>,
    listEwcPredictionOperations({ guildId, season, limit: 50 }),
    getEwcPredictionAutomationHealth(guildId, season),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const rounds = await Promise.all(
    weeks.map(async (week) => {
      const [predictions, reminders] = await Promise.all([
        listWeeklyPredictions(week.id) as Promise<RawPrediction[]>,
        listEwcPredictionRemindersForWeek(week.id),
      ]);
      return {
        weekKey: week.week_key,
        label: week.label || week.week_key,
        effectiveStatus: effectiveEwcWeekStatus(week, now).label,
        status: week.status,
        openAt: week.open_at ?? null,
        closeAt: week.close_at ?? null,
        scoredAt: week.scored_at ?? null,
        gameCount: Array.isArray(week.games) ? week.games.length : 0,
        participantCount: predictions.length,
        scoredCount: predictions.filter((prediction) => prediction.score != null).length,
        baselineAvailable: Boolean(week.baseline?.length),
        finalAvailable: Boolean(week.final?.length),
        resultsAvailable: Boolean(week.results?.length),
        reminders: reminderSummary(reminders),
      };
    }),
  );
  return {
    guildId,
    season,
    seasonRound: seasonRound
      ? { status: seasonRound.status, scoredAt: seasonRound.scored_at ?? null, finalAvailable: Boolean(seasonRound.final?.length) }
      : null,
    rounds,
    operations: operations.map((operation) => ({
      id: operation.id,
      operation: operation.operation,
      status: operation.status,
      requestedAt: operation.requestedAt,
      completedAt: operation.completedAt,
      attempts: operation.attempts,
      result: operation.result,
      error: operation.error,
      targetWeekKey: typeof operation.args?.weekKey === "string" ? operation.args.weekKey : null,
    })),
    health: health
      ? { lastAttemptAt: health.lastAttemptAt, lastSuccessAt: health.lastSuccessAt, lastError: health.lastError }
      : null,
  };
}
