export type PredictionOperationName = "refresh_leaderboard" | "score_week" | "score_season" | "reopen_week" | "delete_week";

export type PredictionOperationRequest = {
  operation: PredictionOperationName;
  args: Record<string, string>;
};

// The confirmation model is deliberately round-owned. The UI never accepts a
// free-form target from an input or an event value, so a stale dialog cannot
// submit a different week than the one it describes.
export function predictionOperationRequest(
  operation: PredictionOperationName,
  weekKey: string | null,
  confirmation = "",
): PredictionOperationRequest {
  if (operation === "refresh_leaderboard" || operation === "score_season") return { operation, args: {} };
  if (!weekKey) throw new Error("A prediction round is required.");
  if (operation === "delete_week") {
    return { operation, args: { weekKey, confirmationWeekKey: confirmation } };
  }
  return { operation, args: { weekKey } };
}
