const STANDINGS_GAMES = new Set([
  'apexlegends',
  'easportsfc',
  'fighters',
  'fortnite',
  'freefire',
  'pubg',
  'pubgmobile',
  'tft',
  'warzone',
]);

export function isStandingsGame(game) {
  return STANDINGS_GAMES.has(String(game ?? '').trim().toLowerCase());
}
