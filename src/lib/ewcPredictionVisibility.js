const nowSec = () => Math.floor(Date.now() / 1000);

export function seasonPicksVisible(round, score = null, now = nowSec()) {
  return Boolean(
    score != null ||
      !round ||
      round.status === 'closed' ||
      round.status === 'scored' ||
      (round.close_at && now >= round.close_at),
  );
}

export function weeklyPickVisible(row, pick, now = nowSec()) {
  if (row?.score != null || row?.status === 'scored') return true;
  if (pick && typeof pick === 'object') {
    const game = (row?.games || []).find((roundGame) => roundGame.key === pick.gameKey);
    return Boolean(game?.lockAt && now >= game.lockAt);
  }
  return Boolean(row?.close_at && now >= row.close_at);
}

// A score explanation is meaningful only after the authoritative scorer persisted
// details for this prediction. This deliberately excludes unscored owner picks.
export function scoreBreakdownVisible(row) {
  return row?.score != null;
}
