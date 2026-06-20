// Liquipedia wikis. `slug` is the path segment in liquipedia.net/<slug>/... and matches what
// the bot auto-detects from a tournament URL, so an explicit pick stays consistent with it.
// `tag` is the short badge shown on the leaderboard.
export const GAMES = [
  { name: 'Valorant', slug: 'valorant', tag: 'VCT' },
  { name: 'League of Legends', slug: 'leagueoflegends', tag: 'LoL' },
  { name: 'Counter-Strike', slug: 'counterstrike', tag: 'CS' },
  { name: 'Dota 2', slug: 'dota2', tag: 'Dota2' },
  { name: 'Rocket League', slug: 'rocketleague', tag: 'RL' },
  { name: 'Overwatch', slug: 'overwatch', tag: 'OW' },
  { name: 'Rainbow Six', slug: 'rainbowsix', tag: 'R6' },
  { name: 'Apex Legends', slug: 'apexlegends', tag: 'Apex' },
  { name: 'Mobile Legends', slug: 'mobilelegends', tag: 'MLBB' },
  { name: 'PUBG Mobile', slug: 'pubgmobile', tag: 'PUBGM' },
  { name: 'PUBG', slug: 'pubg', tag: 'PUBG' },
  { name: 'StarCraft II', slug: 'starcraft2', tag: 'SC2' },
  { name: 'Honor of Kings', slug: 'honorofkings', tag: 'HoK' },
  { name: 'Call of Duty', slug: 'callofduty', tag: 'CoD' },
  { name: 'Marvel Rivals', slug: 'marvelrivals', tag: 'MRivals' },
  { name: 'Fortnite', slug: 'fortnite', tag: 'FN' },
  { name: 'Super Smash Bros', slug: 'smash', tag: 'Smash' },
  { name: 'EA Sports FC', slug: 'easportsfc', tag: 'FC' },
  { name: 'Hearthstone', slug: 'hearthstone', tag: 'HS' },
  { name: 'Wild Rift', slug: 'wildrift', tag: 'WR' },
  { name: 'Brawl Stars', slug: 'brawlstars', tag: 'BS' },
  { name: 'Age of Empires', slug: 'ageofempires', tag: 'AoE' },
  { name: 'Warcraft', slug: 'warcraft', tag: 'WC' },
  { name: 'World of Tanks', slug: 'worldoftanks', tag: 'WoT' },
  { name: 'Heroes of the Storm', slug: 'heroes', tag: 'HotS' },
  { name: 'Free Fire', slug: 'freefire', tag: 'FF' },
  { name: 'Delta Force', slug: 'deltaforce', tag: 'DF' },
  { name: 'Teamfight Tactics', slug: 'tft', tag: 'TFT' },
  { name: 'Clash Royale', slug: 'clashroyale', tag: 'CR' },
  { name: 'CrossFire', slug: 'crossfire', tag: 'CF' },
  { name: 'Deadlock', slug: 'deadlock', tag: 'DL' },
  { name: 'Trackmania', slug: 'trackmania', tag: 'TM' },
  { name: 'Halo', slug: 'halo', tag: 'Halo' },
  { name: 'osu!', slug: 'osu', tag: 'osu' },
  { name: 'Clash of Clans', slug: 'clashofclans', tag: 'CoC' },
  { name: 'Team Fortress', slug: 'teamfortress', tag: 'TF2' },
  { name: 'Sim Racing', slug: 'simracing', tag: 'SimR' },
  { name: 'The Finals', slug: 'thefinals', tag: 'Finals' },
  { name: 'Brawlhalla', slug: 'brawlhalla', tag: 'BH' },
  { name: 'Naraka: Bladepoint', slug: 'naraka', tag: 'Naraka' },
  { name: 'Splatoon', slug: 'splatoon', tag: 'Splat' },
  { name: 'War Thunder', slug: 'warthunder', tag: 'WT' },
  { name: 'Stormgate', slug: 'stormgate', tag: 'SG' },
  { name: 'Tekken', slug: 'fighters', tag: 'FGC' },
  { name: 'Street Fighter', slug: 'fighters', tag: 'FGC' },
  { name: 'Fatal Fury', slug: 'fighters', tag: 'FGC' },
  { name: 'Chess', slug: 'chess', tag: 'Chess' },
  { name: 'Esports / multi-game (EWC)', slug: 'esports', tag: 'EWC' },
];

const BY_SLUG = new Map(GAMES.map((g) => [g.slug, g]));
const BY_NAME = new Map(GAMES.map((g) => [g.name.toLowerCase(), g]));
const GAME_ALIASES = { teamfighttactics: 'tft' };

// Resolve a source-supplied display name (e.g. start.gg's videogame.name "Rocket League")
// to a registered game slug, or null if we don't track it. Lets start.gg tournaments —
// whose URLs don't encode the game the way Liquipedia's do — group under the right board.
export function gameSlugFromName(name) {
  if (!name) return null;
  return BY_NAME.get(String(name).trim().toLowerCase())?.slug ?? null;
}
const LOBBY_GAMES = new Set(['apexlegends', 'freefire', 'fortnite', 'pubg', 'pubgmobile', 'teamfighttactics', 'tft']);

// Short tag for a game key (handles wiki slugs, a few legacy codes, and unknowns).
const LEGACY_TAGS = { lol: 'LoL', cs2: 'CS', csgo: 'CS', rl: 'RL', ow: 'OW', other: '' };
export function gameTag(game) {
  if (!game) return '';
  const slug = normalizeGameSlug(game);
  if (BY_SLUG.has(slug)) return BY_SLUG.get(slug).tag;
  if (game in LEGACY_TAGS) return LEGACY_TAGS[game];
  return game.length <= 6 ? game.toUpperCase() : `${game.slice(0, 5).toUpperCase()}`;
}

// Friendly display name for a game slug (falls back to the slug itself).
export function gameName(slug) {
  return BY_SLUG.get(normalizeGameSlug(slug))?.name || slug;
}

export function isLobbyGame(slug) {
  return LOBBY_GAMES.has(slug) || LOBBY_GAMES.has(normalizeGameSlug(slug));
}

export function normalizeGameSlug(slug) {
  return GAME_ALIASES[slug] || slug;
}

export function sameGame(a, b) {
  return normalizeGameSlug(a) === normalizeGameSlug(b);
}

// Resolve a user-supplied game value (slug or alias) to its registered game, or null if unknown.
export function getGame(slug) {
  return BY_SLUG.get(normalizeGameSlug(slug)) || null;
}

export function isKnownGameSlug(slug) {
  return BY_SLUG.has(normalizeGameSlug(slug));
}

// True when a match's tournament is part of the Esports World Cup (detected from the Liquipedia
// page path / URL, e.g. "counterstrike/Esports_World_Cup/2026" or "esports/Esports_World_Cup/...").
export function isEwcMatch(m) {
  const hay = `${m?.tournament_path || ''} ${m?.tournament_url || ''} ${m?.external_id || ''}`.toLowerCase();
  return /esports[_ ]?world[_ ]?cup/.test(hay);
}

// Tekken, Street Fighter, Fatal Fury, etc. all share Liquipedia's `fighters` wiki, so the slug
// alone can't tell them apart — disambiguate from the tournament name.
function fightersTag(name) {
  const n = String(name || '').toLowerCase();
  if (/street fighter/.test(n)) return 'SF6';
  if (/fatal fury/.test(n)) return 'FatalFury';
  if (/tekken/.test(n)) return 'Tekken';
  if (/guilty gear/.test(n)) return 'GGST';
  if (/mortal kombat/.test(n)) return 'MK';
  if (/king of fighters|\bkof\b/.test(n)) return 'KOF';
  return 'FGC';
}

// Tag for a specific match row (fighters-aware). Use instead of gameTag(m.game) in match lists.
export function matchTag(m) {
  if (!m) return '';
  if (normalizeGameSlug(m.game) === 'fighters') return fightersTag(m.tournament_name);
  return gameTag(m.game);
}

// matchTag plus a " - EWC" suffix when the match belongs to the Esports World Cup.
export function matchTagEwc(m) {
  const tag = matchTag(m);
  return tag && isEwcMatch(m) ? `${tag} - EWC` : tag;
}

// Up to 25 autocomplete choices matching a query by name or slug.
export function searchGames(query, { includeAll = false } = {}) {
  const q = (query || '').toLowerCase().trim();
  const list = q ? GAMES.filter((g) => g.name.toLowerCase().includes(q) || g.slug.includes(q)) : GAMES;
  const choices = [];
  if (includeAll && (!q || 'all games'.includes(q) || q === 'all')) {
    choices.push({ name: 'All games', value: 'all' });
  }
  choices.push(...list.map((g) => ({ name: g.name, value: g.slug })));
  return choices.slice(0, 25);
}
