import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// PandaScore REST API — covers Valorant, LoL, CS2, Rocket League, Overwatch, Dota2, etc.
// Docs: https://developers.pandascore.co/reference
const client = axios.create({
  baseURL: config.pandascore.baseUrl,
  timeout: 15_000,
  headers: config.pandascore.token ? { Authorization: `Bearer ${config.pandascore.token}` } : {},
});

// Normalize a PandaScore match object into our internal shape.
function normalizeMatch(m) {
  const [a, b] = m.opponents ?? [];
  return {
    source: 'pandascore',
    externalId: String(m.id),
    name: m.name,
    teamA: a?.opponent?.name ?? 'TBD',
    teamB: b?.opponent?.name ?? 'TBD',
    scheduledAt: m.begin_at ? Math.floor(new Date(m.begin_at).getTime() / 1000) : null,
    status: m.status === 'running' ? 'running' : m.status === 'finished' ? 'finished' : 'scheduled',
  };
}

// Today's matches for a tracked tournament/serie.
export async function fetchSchedule(tournament) {
  if (!config.pandascore.token) {
    logger.warn('[pandascore] PANDASCORE_TOKEN not set — skipping.');
    return [];
  }
  // TODO: implement once we confirm whether external_id is a tournament/serie/league id.
  //   GET /tournaments/{id}/matches?sort=begin_at&filter[...]   (today's range)
  //   const { data } = await client.get(`/tournaments/${tournament.external_id}/matches`, { params });
  //   return data.map(normalizeMatch);
  logger.debug(`[pandascore] (stub) fetchSchedule for ${tournament.external_id}`);
  return [];
}

// Live score poll for one match.
export async function fetchMatch(matchId) {
  if (!config.pandascore.token) return null;
  // TODO: const { data } = await client.get(`/matches/${matchId}`); return normalizeMatch(data);
  return null;
}

export { client as pandascoreClient, normalizeMatch };
