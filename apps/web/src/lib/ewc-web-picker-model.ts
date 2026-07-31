export type PickerGameResult = {
  points: number;
  matchedClub: string | null;
  place: string | null;
  winner: string | null;
};

export type PickerGame = {
  key: string;
  game: string;
  event: string | null;
  lockAt: number | null;
  state: "open" | "locked";
  pick: string | null;
  choices?: string[];
  // True when the choice list mixes individual entrants with clubs (solo games).
  individualPicks?: boolean;
  result?: PickerGameResult | null;
};

export type PickerRound = {
  weekKey: string;
  label: string;
  // "actionable" rounds still accept saves; "review" rounds are finished and read-only.
  state?: "actionable" | "review";
  status?: string;
  closeAt?: number | null;
  nextLockAt?: number | null;
  pickedGames?: number;
  totalGames?: number;
  score?: number | null;
  games: PickerGame[];
};

export function actionablePickerGames(rounds: PickerRound[]) {
  return rounds.flatMap((round) => round.games.filter((game) => game.state === "open").map((game) => ({ ...game, weekKey: round.weekKey, label: round.label })));
}

// Locked games are no longer editable, but the member still needs to see what they
// picked for each one — the picker is private to the signed-in member, so showing the
// saved club here never exposes another member's prediction.
export function lockedPickerGames(rounds: PickerRound[]) {
  return rounds.flatMap((round) => round.games.filter((game) => game.state === "locked").map((game) => ({ ...game, weekKey: round.weekKey, label: round.label })));
}

// Rounds split by what the member can do with them: save picks, or only look back.
export function pickerRoundGroups(rounds: PickerRound[]) {
  const live = rounds.filter((round) => (round.state ?? "actionable") === "actionable");
  const review = rounds.filter((round) => round.state === "review");
  return { live, review };
}

export function roundPickProgress(round: PickerRound) {
  const total = round.totalGames ?? round.games.length;
  const picked = round.pickedGames ?? round.games.filter((game) => game.pick).length;
  return { picked, total, percent: total ? Math.min(100, Math.round((picked / total) * 100)) : 0 };
}

// Games a round can still take a pick for, before the ones that already locked, so the
// list always leads with what the member can act on.
export function orderedRoundGames(round: PickerRound) {
  const open = round.games.filter((game) => game.state === "open");
  const locked = round.games.filter((game) => game.state !== "open");
  return { open, locked };
}

export function seasonPickerSlots(picks: string[], topSize: number) {
  const size = Math.max(0, Math.min(20, Math.floor(topSize)));
  return Array.from({ length: size }, (_, index) => ({ index, pick: picks[index] || null, locked: index > picks.length }));
}

export function effectiveSeasonPickerStatus(
  round: { status: string; openAt: number | null; closeAt: number | null } | null,
  now: number,
) {
  if (!round) return null;
  if (round.status !== "open") return round.status;
  if (round.openAt !== null && now < round.openAt) return "upcoming";
  if (round.closeAt !== null && now >= round.closeAt) return "locked";
  return "open";
}

export function knownPickerClubs(rounds: PickerRound[], seasonPicks: string[], seasonChoices: string[] = []) {
  return [...new Set([
    ...seasonChoices,
    ...seasonPicks,
    ...rounds.flatMap((round) => round.games.flatMap((game) => game.choices || [])),
    ...rounds.flatMap((round) => round.games.map((game) => game.pick).filter((pick): pick is string => Boolean(pick))),
  ])].sort((a, b) => a.localeCompare(b));
}
