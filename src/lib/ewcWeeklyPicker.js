export const WEEKLY_PICKER_COMPONENT_BUDGET = 40;
export const WEEKLY_PICKER_GAME_COMPONENT_COST = 3;
// Header/status, a week selector, and Prev/Next controls reserve eight V2
// components. Keep one named budget so future controls cannot reintroduce a cap.
export const WEEKLY_PICKER_RESERVED_COMPONENTS = 8;
export const WEEKLY_PICKER_PAGE_SIZE = Math.floor(
  (WEEKLY_PICKER_COMPONENT_BUDGET - WEEKLY_PICKER_RESERVED_COMPONENTS) / WEEKLY_PICKER_GAME_COMPONENT_COST,
);

function clampPage(page, totalPages) {
  return Math.min(Math.max(0, Number.isInteger(Number(page)) ? Number(page) : 0), totalPages - 1);
}

export function weeklyPickerPage(games, picks, page, now = Math.floor(Date.now() / 1000)) {
  const allGames = Array.isArray(games) ? games.filter((game) => game?.key) : [];
  const totalPages = Math.max(1, Math.ceil(allGames.length / WEEKLY_PICKER_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const picksByGame = new Map(
    (Array.isArray(picks) ? picks : [])
      .filter((pick) => pick && typeof pick === 'object' && pick.gameKey)
      .map((pick) => [String(pick.gameKey), pick]),
  );
  const start = currentPage * WEEKLY_PICKER_PAGE_SIZE;
  return {
    page: currentPage,
    totalPages,
    totalGames: allGames.length,
    pickedGames: allGames.filter((game) => picksByGame.has(String(game.key))).length,
    games: allGames.slice(start, start + WEEKLY_PICKER_PAGE_SIZE).map((game) => ({
      ...game,
      existingPick: picksByGame.get(String(game.key)) || null,
      locked: Boolean(game.lockAt && now >= game.lockAt),
    })),
  };
}

export function weeklyPickerPageForGame(games, gameKey) {
  const index = (Array.isArray(games) ? games : []).findIndex((game) => game?.key === gameKey);
  return index < 0 ? 0 : Math.floor(index / WEEKLY_PICKER_PAGE_SIZE);
}

export function weeklyModalSelection({ manual, selections }) {
  const manualPick = String(manual || '').replace(/\s+/g, ' ').trim();
  if (manualPick) return { kind: 'pick', pick: manualPick };
  const selected = (Array.isArray(selections) ? selections : [])
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!selected.length) return { kind: 'empty' };
  if (selected.length > 1) return { kind: 'ambiguous' };
  return { kind: 'pick', pick: selected[0] };
}
