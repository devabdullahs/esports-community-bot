import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Start.gg GraphQL API — best for community brackets and EWC-style multi-event tournaments.
// Docs: https://developer.start.gg/docs/intro
const client = axios.create({
  baseURL: config.startgg.baseUrl,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    ...(config.startgg.token ? { Authorization: `Bearer ${config.startgg.token}` } : {}),
  },
});

export async function query(gql, variables = {}) {
  const { data } = await client.post('', { query: gql, variables });
  if (data.errors) throw new Error(data.errors.map((e) => e.message).join('; '));
  return data.data;
}

export async function fetchSchedule(tournament) {
  if (!config.startgg.token) {
    logger.warn('[startgg] STARTGG_TOKEN not set — skipping.');
    return [];
  }
  // TODO: query by slug for today's sets, e.g.
  //   tournament(slug: $slug) { events { sets(page,perPage,filters:{...}) {
  //     nodes { id fullRoundText startAt state slots { entrant { name } standing { stats { score { value } } } } }
  //   } } }
  logger.debug(`[startgg] (stub) fetchSchedule for ${tournament.external_id}`);
  return [];
}

export { client as startggClient };
