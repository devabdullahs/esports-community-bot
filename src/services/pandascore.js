import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// PandaScore REST API (the free tier serves upcoming/live/finished match data).
// Covers LoL, CS, Dota 2, Valorant, Overwatch, Rocket League, and more.
// Docs: https://developers.pandascore.co/reference
const client = axios.create({
  baseURL: config.pandascore.baseUrl,
  timeout: 15_000,
  headers: config.pandascore.token ? { Authorization: `Bearer ${config.pandascore.token}` } : {},
});

// Normalize a PandaScore match object into the bot's standard match shape.
export function normalizeMatch(m) {
  const [a, b] = m.opponents ?? [];
  const idA = a?.opponent?.id;
  const idB = b?.opponent?.id;
  const results = m.results ?? [];
  const scoreOf = (id) => {
    const r = results.find((x) => x.team_id === id || x.player_id === id || x.id === id);
    return r && r.score != null ? Number(r.score) : null;
  };
  const teamA = a?.opponent?.name ?? 'TBD';
  const teamB = b?.opponent?.name ?? 'TBD';
  const winnerId = m.winner_id;
  return {
    source: 'pandascore',
    externalId: String(m.id),
    name: m.name || `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    scoreA: scoreOf(idA),
    scoreB: scoreOf(idB),
    bestOf: m.number_of_games ?? null,
    scheduledAt: m.begin_at ? Math.floor(new Date(m.begin_at).getTime() / 1000) : null,
    status: m.status === 'running' ? 'running' : m.status === 'finished' ? 'finished' : 'scheduled',
    winner: winnerId ? (winnerId === idA ? teamA : winnerId === idB ? teamB : null) : null,
  };
}

// Matches for a tracked PandaScore id (external_id may be a tournament id or a serie id).
export async function fetchSchedule(tournament) {
  if (!config.pandascore.token) {
    logger.warn('[pandascore] PANDASCORE_TOKEN not set — skipping.');
    return [];
  }
  const id = encodeURIComponent(tournament.external_id);
  for (const path of [`/tournaments/${id}/matches`, `/series/${id}/matches`]) {
    try {
      const { data } = await client.get(path, { params: { per_page: 50, sort: 'begin_at' } });
      if (Array.isArray(data) && data.length) {
        return data.map(normalizeMatch).filter((m) => m.teamA !== 'TBD' || m.teamB !== 'TBD');
      }
    } catch (e) {
      if (e.response?.status && e.response.status !== 404) {
        logger.warn(`[pandascore] ${path}: HTTP ${e.response.status}`);
      }
    }
  }
  return [];
}

export { client as pandascoreClient };
