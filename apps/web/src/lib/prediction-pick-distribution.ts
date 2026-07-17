import "server-only";

import { getWeeklyPickDistribution } from "@bot/db/ewcPredictions.js";

export type PredictionPickDistribution = {
  locked: boolean;
  totalPicks: number;
  games: Array<{
    gameKey: string;
    game: string;
    event: string | null;
    totalPicks: number;
    picks: Array<{
      pick: string;
      count: number;
      percentage: number;
    }>;
  }>;
};

type PredictionRound = { id: number };

export async function getPredictionPickDistributions(
  guildId: string | null,
  rounds: PredictionRound[],
  nowSec = Math.floor(Date.now() / 1000),
) {
  if (!guildId || !rounds.length) return new Map<number, PredictionPickDistribution>();

  const entries = await Promise.all(
    [...new Set(rounds.map((round) => round.id))].map(async (weekId) => [
      weekId,
      (await getWeeklyPickDistribution(guildId, weekId, nowSec)) as PredictionPickDistribution,
    ] as const),
  );
  return new Map(entries);
}
