export type PickerGame = {
  key: string;
  game: string;
  event: string | null;
  lockAt: number | null;
  state: "open" | "locked";
  pick: string | null;
};

export type PickerRound = { weekKey: string; label: string; games: PickerGame[] };

export function actionablePickerGames(rounds: PickerRound[]) {
  return rounds.flatMap((round) => round.games.filter((game) => game.state === "open").map((game) => ({ ...game, weekKey: round.weekKey, label: round.label })));
}

export function seasonPickerSlots(picks: string[], topSize: number) {
  const size = Math.max(0, Math.min(20, Math.floor(topSize)));
  return Array.from({ length: size }, (_, index) => ({ index, pick: picks[index] || null, locked: index > picks.length }));
}

export function knownPickerClubs(rounds: PickerRound[], seasonPicks: string[]) {
  return [...new Set([
    ...seasonPicks,
    ...rounds.flatMap((round) => round.games.map((game) => game.pick).filter((pick): pick is string => Boolean(pick))),
  ])].sort((a, b) => a.localeCompare(b));
}
