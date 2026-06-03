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
      logger.warn(`[ewc] club cache refresh failed: ${error.message}`);
      return cachedClubs;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
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

export async function searchEwcClubChoices(query, { wait = false } = {}) {
  const q = normalizeClubName(query);
  const clubs = await getEwcClubsCached({ wait });
  const matches = q
    ? clubs.filter((club) => normalizeClubName(club.name).includes(q))
    : clubs.slice(0, 25);
  return matches.slice(0, 25).map((club) => ({
    name: `${club.name} (${club.qualifiedCount}/${club.possibleEvents ?? '?'})`.slice(0, 100),
    value: club.name,
  }));
}
