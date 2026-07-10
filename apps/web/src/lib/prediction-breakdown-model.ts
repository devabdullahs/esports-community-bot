export type ScoreBreakdownStatus = "scored" | "missed" | "unmatched" | "late";

export type PredictionBreakdownRow = {
  game?: string | null;
  pick?: string | null;
  matchedClub?: string | null;
  matchedTeam?: string | null;
  placement?: string | null;
  winner?: string | null;
  weeklyRank?: number | null;
  predictedRank?: number | null;
  actualRank?: number | null;
  hitPoints?: number | null;
  exactBonus?: number | null;
  points: number;
  status: ScoreBreakdownStatus;
};

export type PredictionBreakdown = {
  available: boolean;
  kind: "weekly" | "weekly-per-game" | "weekly-aggregate" | "season";
  total: number;
  bonus: number;
  rows: PredictionBreakdownRow[];
  integrity: "ok" | "mismatch" | "unavailable";
};

export function isExpandableScoreBreakdown(
  breakdown: PredictionBreakdown | null,
): breakdown is PredictionBreakdown & { available: true } {
  return Boolean(breakdown?.available);
}

export function scoreBreakdownStatusKey(status: string): ScoreBreakdownStatus {
  return status === "missed" || status === "unmatched" || status === "late" ? status : "scored";
}
