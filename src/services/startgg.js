import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Start.gg GraphQL API (free tier). Best for FGC / community brackets hosted on start.gg.
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

const SETS_QUERY = `query Sets($slug: String!, $perPage: Int!) {
  tournament(slug: $slug) {
    events {
      sets(page: 1, perPage: $perPage, sortType: RECENT) {
        nodes {
          id state startAt winnerId
          slots { entrant { id name } standing { stats { score { value } } } }
        }
      }
    }
  }
}`;

// Normalize a start.gg set into the bot's standard match shape.
function normalizeSet(s) {
  const [s1, s2] = s.slots ?? [];
  const teamA = s1?.entrant?.name ?? 'TBD';
  const teamB = s2?.entrant?.name ?? 'TBD';
  if (teamA === 'TBD' && teamB === 'TBD') return null;
  const scoreOf = (slot) => {
    const v = slot?.standing?.stats?.score?.value;
    return v != null && v >= 0 ? Number(v) : null;
  };
  const idA = s1?.entrant?.id;
  const idB = s2?.entrant?.id;
  // winnerId is set once the set completes; state 2 means it's actively being played.
  let status = 'scheduled';
  if (s.winnerId) status = 'finished';
  else if (s.state === 2) status = 'running';
  return {
    source: 'startgg',
    externalId: `sgg:${s.id}`,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    scoreA: scoreOf(s1),
    scoreB: scoreOf(s2),
    bestOf: null,
    scheduledAt: s.startAt ?? null,
    status,
    winner: s.winnerId ? (s.winnerId === idA ? teamA : s.winnerId === idB ? teamB : null) : null,
  };
}

// Matches (sets) for a tracked start.gg tournament (external_id = slug, e.g. "evo-2024").
export async function fetchSchedule(tournament) {
  if (!config.startgg.token) {
    logger.warn('[startgg] STARTGG_TOKEN not set — skipping.');
    return [];
  }
  const raw = tournament.external_id;
  const slug = raw.includes('/') ? raw : `tournament/${raw}`;
  // start.gg caps each request at 1000 returned objects; tournaments with many events (e.g. Evo)
  // exceed that, so start big and retry with fewer sets-per-event if it's too complex.
  let data;
  try {
    data = await query(SETS_QUERY, { slug, perPage: 40 });
  } catch (e) {
    if (/complexity/i.test(e.message)) {
      logger.debug('[startgg] query too complex, retrying with fewer sets per event');
      data = await query(SETS_QUERY, { slug, perPage: 6 });
    } else {
      throw e;
    }
  }
  const out = [];
  const seen = new Set();
  for (const ev of data?.tournament?.events ?? []) {
    for (const node of ev?.sets?.nodes ?? []) {
      const m = normalizeSet(node);
      if (m && !seen.has(m.externalId)) {
        seen.add(m.externalId);
        out.push(m);
      }
    }
  }
  return out;
}

export { client as startggClient };
