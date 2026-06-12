import { fetchEwcClubs } from '../services/liquipedia.js';
import { normalizeClubName } from './ewcPredictions.js';
import { logger } from './logger.js';

const TTL_MS = 6 * 60 * 60 * 1000;

let cachedAt = 0;
let cachedClubs = [];
let inFlight = null;

function refreshEwcClubCache() {
  if (inFlight) return inFlight;
  inFlight = fetchEwcClubs()
    .then((data) => {
      cachedClubs = data.clubs || [];
      cachedAt = Date.now();
      return cachedClubs;
    })
    .catch((error) => {
      const level = /backing off after a rate limit/i.test(error.message) ? 'debug' : 'warn';
      logger[level](`[ewc] club cache refresh failed: ${error.message}`);
      return cachedClubs;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function gameKey(value) {
  return normalizeClubName(value)
    .replace(/:\s*/g, ' ')
    .replace(/\b(world cup|championship|mid season cup|women'?s invitational|city of the wolves|black ops 7|resurgence series)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clubHasGame(club, game) {
  const wanted = gameKey(game);
  if (!wanted) return true;
  return (club.games || []).some((entry) => {
    const label = gameKey(entry.label);
    const short = gameKey(entry.shortLabel);
    return label === wanted || short === wanted || label.includes(wanted) || wanted.includes(label);
  });
}

function gameScopedPool(clubs, game, strictGame = false) {
  if (!game) return { pool: clubs, scoped: clubs, scopedAvailable: false };
  const scoped = clubs.filter((club) => clubHasGame(club, game));
  return {
    pool: scoped.length || strictGame ? scoped : clubs,
    scoped,
    scopedAvailable: scoped.length > 0,
  };
}

export function primeEwcClubCache() {
  refreshEwcClubCache().catch(() => {});
}

export async function getEwcClubsCached({ wait = true } = {}) {
  const fresh = cachedClubs.length && Date.now() - cachedAt < TTL_MS;
  if (fresh) return cachedClubs;

  const refresh = refreshEwcClubCache();
  if (wait && !cachedClubs.length) return refresh;
  return cachedClubs;
}

export async function searchEwcClubChoices(query, { wait = false, game = null, strictGame = false } = {}) {
  const q = normalizeClubName(query);
  const clubs = await getEwcClubsCached({ wait });
  const { pool, scopedAvailable } = gameScopedPool(clubs, game, strictGame);
  const matches = q
    ? pool.filter((club) => normalizeClubName(club.name).includes(q))
    : pool.slice(0, 25);
  return matches.slice(0, 25).map((club) => ({
    name: `${club.name}${game && scopedAvailable ? ` - ${game}` : ` (${club.qualifiedCount}/${club.possibleEvents ?? '?'})`}`.slice(0, 100),
    value: club.name,
  }));
}

export async function resolveEwcClubPick(query, { wait = false, game = null, strictGame = false } = {}) {
  const raw = String(query ?? '').replace(/\s+/g, ' ').trim();
  const q = normalizeClubName(raw);
  if (!q) return { ok: false, message: 'Type a club name.' };

  const clubs = await getEwcClubsCached({ wait });
  if (!clubs.length) return { ok: true, name: raw, verified: false };

  // Prefer the game-scoped pool when it exists (keeps fighters SF/Tekken/Fatal Fury separate).
  // If strict scoping finds no clubs for this game — a label mismatch, or a game not yet in the
  // club data — fall back to the full EWC club list instead of rejecting every pick for that game
  // (scoping isn't disambiguating anything for that game in that case anyway).
  const { scoped, scopedAvailable } = gameScopedPool(clubs, game, strictGame);
  const pool = scopedAvailable ? scoped : clubs;

  const exact = pool.find((club) => normalizeClubName(club.name) === q);
  if (exact) return { ok: true, name: exact.name, verified: true };

  const matches = pool.filter((club) => normalizeClubName(club.name).includes(q)).slice(0, 6);
  if (matches.length === 1 && q.length >= 4) return { ok: true, name: matches[0].name, verified: true };

  if (matches.length) {
    return {
      ok: false,
      message: `I found multiple possible clubs. Type one of these exactly:\n${matches.map((club) => `- ${club.name}`).join('\n')}`,
    };
  }

  return {
    ok: false,
    message: game
      ? `I could not match that club in the ${game} EWC club list. Try the select menu or type the official club name.`
      : 'I could not match that club in the EWC club list. Try `/ewc_predict teams` to search the official names.',
  };
}
