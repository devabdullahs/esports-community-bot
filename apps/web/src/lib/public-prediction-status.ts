import "server-only";

import { unstable_cache } from "next/cache";
import { listEwcWeeks } from "@bot/db/ewcPredictions.js";
import { effectiveEwcWeekStatus } from "@bot/lib/ewcPredictions.js";
import { categorizeEwcPredictionRounds } from "@bot/lib/ewcPredictionRounds.js";
import { DEFAULT_SEASON } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";

type PredictionGame = {
  key?: string;
  game?: string | null;
  event?: string | null;
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

export type PublicPredictionRound = {
  id: number;
  weekKey: string;
  label: string;
  status: string;
  opensAt: number | null;
  closesAt: number | null;
  scoreAfter: number | null;
  nextLockAt: number | null;
  openGames: number;
  lockedGames: number;
  totalGames: number;
  games: Array<{
    key: string;
    game: string;
    event: string | null;
    lockAt: number | null;
    state: "open" | "locked";
  }>;
};

export type PublicPredictionStatus = {
  guildId: string | null;
  season: string;
  state: "open" | "upcoming" | "awaiting-scoring" | "idle";
  round: PublicPredictionRound | null;
  rounds: PublicPredictionRound[];
  upcomingRounds: PublicPredictionRound[];
  awaitingRounds: PublicPredictionRound[];
};

function projectRound(round: PredictionWeek, now: number): PublicPredictionRound {
  const status = effectiveEwcWeekStatus(round, now) as {
    label: string;
    openGames: number;
    lockedGames: number;
    totalGames: number;
  };
  const games = Array.isArray(round.games) ? round.games : [];
  const openLocks = games
    .map((game) => Number(game.lockAt))
    .filter((lockAt) => Number.isFinite(lockAt) && lockAt > now);
  return {
    id: round.id,
    weekKey: round.week_key,
    label: round.label || round.week_key,
    status: status.label,
    opensAt: round.open_at ?? null,
    closesAt: round.close_at ?? null,
    scoreAfter: round.score_after ?? null,
    nextLockAt: openLocks.length ? Math.min(...openLocks) : round.close_at ?? null,
    openGames: status.openGames,
    lockedGames: status.lockedGames,
    totalGames: status.totalGames,
    games: games
      .filter((game) => game.key)
      .map((game) => ({
        key: String(game.key),
        game: game.game || String(game.key),
        event: game.event || null,
        lockAt: game.lockAt ?? null,
        state: !game.lockAt || now < game.lockAt ? "open" : "locked",
      })),
  };
}

export function selectPublicPredictionStatus(
  weeks: PredictionWeek[],
  now = Math.floor(Date.now() / 1000),
): Omit<PublicPredictionStatus, "guildId" | "season"> {
  const categorized = categorizeEwcPredictionRounds(weeks, now) as {
    actionable: PredictionWeek[];
    upcoming: PredictionWeek[];
    awaitingScoring: PredictionWeek[];
  };
  const rounds = categorized.actionable.map((round) => projectRound(round, now));
  const upcomingRounds = categorized.upcoming.slice(0, 3).map((round) => projectRound(round, now));
  const awaitingRounds = categorized.awaitingScoring.slice(0, 3).map((round) => projectRound(round, now));
  const fallback = upcomingRounds[0] || awaitingRounds[0] || null;
  const state = rounds.length
    ? "open"
    : upcomingRounds.length
      ? "upcoming"
      : awaitingRounds.length
        ? "awaiting-scoring"
        : "idle";
  return { state, rounds, upcomingRounds, awaitingRounds, round: rounds[0] || fallback };
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
  if (!guildId) return { guildId: null, season, state: "idle", round: null, rounds: [], upcomingRounds: [], awaitingRounds: [] };
  const status = await getCachedStatus(guildId, season);
  return { guildId, season, ...status };
}
