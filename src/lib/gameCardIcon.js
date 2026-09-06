import { loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { normalizeGameSlug } from './games.js';

const ICONS = {
  apexlegends: 'apex_legends', callofduty: 'call_of_duty', chess: 'chess',
  counterstrike: 'cs2', cs2: 'cs2', csgo: 'cs2', dota2: 'dota2',
  easportsfc: 'fifa', fifa: 'fifa', fortnite: 'fortnite', freefire: 'free_fire',
  leagueoflegends: 'league_of_legends', lol: 'league_of_legends',
  mobilelegends: 'mobile_legends', overwatch: 'overwatch', overwatch2: 'overwatch',
  pubg: 'pubg', rainbowsix: 'rainbow_six', rocketleague: 'rocket_league',
  tft: 'tft', valorant: 'valorant', warzone: 'warzone',
};
const images = new Map();

export function loadGameCardIcon(game) {
  const icon = ICONS[normalizeGameSlug(game)];
  if (!icon) return Promise.resolve(null);
  if (!images.has(icon)) {
    const path = fileURLToPath(new URL(`../../assets/game-emojis/128-discord-dark/${icon}.png`, import.meta.url));
    images.set(icon, loadImage(path).catch(() => null));
  }
  return images.get(icon);
}
