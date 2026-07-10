import "server-only";

import { unstable_cache } from "next/cache";
import { listEwcWeeks } from "@bot/db/ewcPredictions.js";
import { effectiveEwcWeekStatus } from "@bot/lib/ewcPredictions.js";
import { selectCurrentOpenEwcWeek } from "@bot/lib/ewcPredictionRounds.js";
import { DEFAULT_SEASON } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";

type PredictionGame = {
  key?: string;
  lockAt?: number | null;
};

type PredictionWeek = {
  id: number;
  week_key: string;
  label?: string | null;
  status?: string | null;
  open_at?: number | null;
  close_at?: number | null;
  score_after?: number | null;
  games?: PredictionGame[];
};

export type PublicPredictionStatus = {
  guildId: string | null;
  season: string;
  state: "open" | "upcoming" | "awaiting-scoring" | "idle";
  round: {
    id: number;
    weekKey: string;
    label: string;
    status: string;
    opensAt: number | null;
    closesAt: number | null;
    scoreAfter: number | null;
    openGames: number;
    lockedGames: number;
    totalGames: number;
  } | null;
};

function projectRound(round: PredictionWeek, now: number) {
  const status = effectiveEwcWeekStatus(round, now) as {
    label: string;
    openGames: number;
    lockedGames: number;
    totalGames: number;
  };
  return {
    id: round.id,
    weekKey: round.week_key,
    label: round.label || round.week_key,
    status: status.label,
    opensAt: round.open_at ?? null,
    closesAt: round.close_at ?? null,
    scoreAfter: round.score_after ?? null,
    openGames: status.openGames,
    lockedGames: status.lockedGames,
    totalGames: status.totalGames,
  };
}

export function selectPublicPredictionStatus(
  weeks: PredictionWeek[],
  now = Math.floor(Date.now() / 1000),
): Omit<PublicPredictionStatus, "guildId" | "season"> {
  const current = selectCurrentOpenEwcWeek(weeks, now) as PredictionWeek | null;
  if (current) return { state: "open", round: projectRound(current, now) };

  const upcoming = [...weeks]
    .filter((week) => effectiveEwcWeekStatus(week, now).label === "opens")
    .sort(
      (a, b) =>
        (a.open_at || Number.POSITIVE_INFINITY) - (b.open_at || Number.POSITIVE_INFINITY) ||
        String(a.week_key).localeCompare(String(b.week_key)),
    )[0];
  if (upcoming) return { state: "upcoming", round: projectRound(upcoming, now) };

  const awaiting = [...weeks]
    .filter((week) => {
      const status = effectiveEwcWeekStatus(week, now).label;
      return week.status !== "scored" && ["locked", "closed"].includes(status);
    })
    .sort(
      (a, b) =>
        (b.close_at || b.score_after || 0) - (a.close_at || a.score_after || 0) ||
        String(a.week_key).localeCompare(String(b.week_key)),
    )[0];
  if (awaiting) return { state: "awaiting-scoring", round: projectRound(awaiting, now) };

  return { state: "idle", round: null };
}

const getCachedStatus = unstable_cache(
  async (guildId: string, season: string) => {
    const weeks = (await listEwcWeeks(guildId, season)) as PredictionWeek[];
    return selectPublicPredictionStatus(weeks);
  },
  ["public-prediction-status"],
  { tags: ["ewc-predictions"], revalidate: 30 },
);

export async function getPublicPredictionStatus(
  season = DEFAULT_SEASON,
): Promise<PublicPredictionStatus> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return { guildId: null, season, state: "idle", round: null };
  const status = await getCachedStatus(guildId, season);
  return { guildId, season, ...status };
}
