export type PredictionOperationName =
  | "refresh_leaderboard"
  | "generate_weeks"
  | "snapshot_week"
  | "score_week"
  | "score_season"
  | "reopen_week"
  | "reopen_season"
  | "delete_week";

export type PredictionOperationRequest = {
  operation: PredictionOperationName;
  args: Record<string, string | number>;
};

// The confirmation model is deliberately round-owned. The UI never accepts a
// free-form target from an input or an event value, so a stale dialog cannot
// submit a different week than the one it describes.
export function predictionOperationRequest(
  operation: PredictionOperationName,
  weekKey: string | null,
  confirmation = "",
  snapshotType: "baseline" | "final" = "baseline",
): PredictionOperationRequest {
  if (["refresh_leaderboard", "score_season", "reopen_season"].includes(operation)) return { operation, args: {} };
  if (operation === "generate_weeks") {
    return { operation, args: { openBeforeHours: 48, lockBeforeHours: 24, scoreDelayHours: 24 } };
  }
  if (!weekKey) throw new Error("A prediction round is required.");
  if (operation === "snapshot_week") return { operation, args: { weekKey, type: snapshotType } };
  if (operation === "delete_week") {
    return { operation, args: { weekKey, confirmationWeekKey: confirmation } };
  }
  return { operation, args: { weekKey } };
}
