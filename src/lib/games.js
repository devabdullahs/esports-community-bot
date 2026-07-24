import { isEwcTournamentReference } from './ewcTournament.js';

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
  { name: 'Fighter Games', slug: 'fighters', tag: 'FGC' },
  { name: 'Chess', slug: 'chess', tag: 'Chess' },
  { name: 'Esports / multi-game (EWC)', slug: 'esports', tag: 'EWC' },
];

const BY_SLUG = new Map(GAMES.map((g) => [g.slug, g]));
const GAME_ALIASES = {
  teamfighttactics: 'tft',
  '2xko': 'fighters',
  blazbluecentralfiction: 'fighters',
  tekken8: 'fighters',
  streetfighter6: 'fighters',
  fatalfurycityofthewolves: 'fighters',
  guiltygearstrive: 'fighters',
  granbluefantasyversusrising: 'fighters',
  invinciblevs: 'fighters',
  rivalsofaetherii: 'fighters',
  undernightinbirthiisysceles: 'fighters',
  vampiresavior: 'fighters',
  virtuafighter5revoworldstage: 'fighters',
};
const GAME_NAME_ALIASES = [
  { name: '2XKO', slug: 'fighters' },
  { name: 'BlazBlue: Central Fiction', slug: 'fighters' },
  { name: 'Fatal Fury', slug: 'fighters' },
  { name: 'Fatal Fury: City of the Wolves', slug: 'fighters' },
  { name: 'Fighting Games', slug: 'fighters' },
  { name: 'Granblue Fantasy Versus: Rising', slug: 'fighters' },
  { name: 'Guilty Gear Strive', slug: 'fighters' },
  { name: 'Invincible VS', slug: 'fighters' },
  { name: 'Rivals of Aether II', slug: 'fighters' },
  { name: 'Street Fighter', slug: 'fighters' },
  { name: 'Street Fighter 6', slug: 'fighters' },
  { name: 'Tekken', slug: 'fighters' },
  { name: 'Tekken 8', slug: 'fighters' },
  { name: 'Under Night In-Birth II Sys:Celes', slug: 'fighters' },
  { name: 'Vampire Savior', slug: 'fighters' },
  { name: 'Virtua Fighter 5 R.E.V.O. World Stage', slug: 'fighters' },
];
const BY_NAME = new Map([
  ...GAMES.map((g) => [g.name.toLowerCase(), g]),
  ...GAME_NAME_ALIASES.map((g) => [g.name.toLowerCase(), { ...BY_SLUG.get(g.slug), slug: g.slug }]),
]);

// Resolve a source-supplied display name (e.g. start.gg's videogame.name "Rocket League")
// to a registered game slug, or null if we don't track it. Lets start.gg tournaments —
// whose URLs don't encode the game the way Liquipedia's do — group under the right board.
export function gameSlugFromName(name) {
  if (!name) return null;
  const raw = String(name).trim();
  const exact = BY_NAME.get(raw.toLowerCase())?.slug;
  if (exact) return exact;
  const norm = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return GAME_ALIASES[norm] ?? null;
}

// Map a live-stream CATEGORY (the game a Twitch/Kick channel is currently playing,
// e.g. "Overwatch 2", "Counter-Strike 2", "VALORANT", "Just Chatting") to a tracked
// game slug, or null when it isn't a game we track (non-esports / off-topic). More
// tolerant than gameSlugFromName: platform category names carry version/edition
// suffixes and punctuation our slugs don't. Used to keep off-topic streams off the
// co-stream surfaces.
export function categoryToGameSlug(category) {
  const raw = String(category ?? '').trim();
  if (!raw) return null;
  const exact = gameSlugFromName(raw); // "Rocket League", "Dota 2", "Valorant", …
  if (exact) return exact;
  const norm = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!norm) return null;
  if (BY_SLUG.has(norm)) return norm;
  if (GAME_ALIASES[norm]) return GAME_ALIASES[norm];
  // Suffix tolerance: a known slug that prefixes the category ("overwatch2" →
  // overwatch, "counterstrike2" → counterstrike, "callofdutyblackops6" →
  // callofduty). Longest slug first so "pubgmobile…" beats "pubg".
  for (const slug of [...BY_SLUG.keys()].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)) {
    if (norm.startsWith(slug)) return normalizeGameSlug(slug);
  }
  return null;
}
const LOBBY_GAMES = new Set(['apexlegends', 'freefire', 'fortnite', 'pubg', 'pubgmobile', 'teamfighttactics', 'tft']);
const INDIVIDUAL_COMPETITOR_GAMES = new Set(['easportsfc', 'fighters', 'chess']);

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

export function isIndividualCompetitorGame(slug) {
  return INDIVIDUAL_COMPETITOR_GAMES.has(normalizeGameSlug(slug));
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
  return isEwcTournamentReference({
    external_id: m?.tournament_path || m?.external_id,
    url: m?.tournament_url,
    name: m?.tournament_name,
    ewc: m?.ewc,
  });
}

// Tekken, Street Fighter, Fatal Fury, etc. all share Liquipedia's `fighters` wiki, so the slug
// alone can't tell them apart — disambiguate from the tournament name. Exported so EWC pick
// scoping can match a week's fighting-game NAME against fighters tournament names.
export function fightersTag(name) {
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
  const seen = new Set();
  const addChoice = (name, value) => {
    const normalized = normalizeGameSlug(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    choices.push({ name, value: normalized });
  };

  if (includeAll && (!q || 'all games'.includes(q) || q === 'all')) {
    choices.push({ name: 'All games', value: 'all' });
    seen.add('all');
  }
  for (const game of list) addChoice(game.name, game.slug);
  if (q) {
    for (const alias of GAME_NAME_ALIASES) {
      const aliasKey = alias.name.toLowerCase();
      if (!aliasKey.includes(q) && !alias.slug.includes(q)) continue;
      addChoice(`${alias.name} (Fighter Games)`, alias.slug);
    }
  }
  return choices.slice(0, 25);
}
