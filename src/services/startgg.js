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

// external_id is the tournament slug ("rlcs-2026-mena-1v1-open") or already a "tournament/<slug>" path.
function slugOf(tournament) {
  const raw = String(tournament?.external_id ?? '');
  return raw.includes('/') ? raw : `tournament/${raw}`;
}

// Lightweight: the tournament's display name + its event ids. One cheap request
// that drives both the title resolver and the per-event set pagination below.
const HEAD_QUERY = `query Head($slug: String!) {
  tournament(slug: $slug) { name events { id name } }
}`;

// One PAGE of an event's sets. start.gg paginates per connection (pageInfo.totalPages),
// so we walk the pages of each event to capture EVERY match — large 1v1 opens routinely
// exceed a single page of 50.
const EVENT_SETS_QUERY = `query EventSets($eventId: ID!, $page: Int!, $perPage: Int!) {
  event(id: $eventId) {
    sets(page: $page, perPage: $perPage, sortType: STANDARD) {
      pageInfo { totalPages }
      nodes {
        id state startAt winnerId
        slots { entrant { id name } standing { stats { score { value } } } }
      }
    }
  }
}`;

// Bounds so one pathological event can't issue unbounded requests. 50 sets/page,
// up to 30 pages = 1500 sets/event ceiling; start.gg's complexity cap is handled
// by retrying the whole event at a smaller page size.
const SETS_PER_PAGE = 50;
const MAX_PAGES_PER_EVENT = 30;
const PAGE_SIZE_LADDER = [SETS_PER_PAGE, 25, 12, 6];

// Normalize a start.gg set into the bot's standard match shape.
export function normalizeSet(s) {
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

// Walk EVERY page of one event's sets. On a start.gg complexity error, restart the
// event from page 1 at a smaller page size (cleaner than mixing page sizes mid-walk).
async function fetchEventSets(eventId, q) {
  for (const perPage of PAGE_SIZE_LADDER) {
    try {
      const nodes = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= MAX_PAGES_PER_EVENT) {
        const data = await q(EVENT_SETS_QUERY, { eventId, page, perPage });
        const conn = data?.event?.sets;
        totalPages = Math.min(Number(conn?.pageInfo?.totalPages) || 1, MAX_PAGES_PER_EVENT);
        for (const node of conn?.nodes ?? []) nodes.push(node);
        page += 1;
      }
      return nodes;
    } catch (e) {
      if (/complexity/i.test(e.message) && perPage > PAGE_SIZE_LADDER[PAGE_SIZE_LADDER.length - 1]) {
        logger.debug(`[startgg] event ${eventId} too complex at perPage ${perPage}; retrying smaller`);
        continue;
      }
      throw e;
    }
  }
  return [];
}

// All matches (sets) for a tracked start.gg tournament, across ALL of its events,
// fully paginated. `query` is injectable for tests (no network).
export async function fetchSchedule(tournament, { query: q = query } = {}) {
  if (!config.startgg.token) {
    logger.warn('[startgg] STARTGG_TOKEN not set — skipping.');
    return [];
  }
  const slug = slugOf(tournament);
  const head = await q(HEAD_QUERY, { slug });
  const events = head?.tournament?.events ?? [];

  const out = [];
  const seen = new Set();
  for (const ev of events) {
    if (!ev?.id) continue;
    const nodes = await fetchEventSets(ev.id, q);
    for (const node of nodes) {
      const m = normalizeSet(node);
      if (m && !seen.has(m.externalId)) {
        seen.add(m.externalId);
        out.push(m);
      }
    }
  }
  return out;
}

// Resolve a tracked start.gg tournament's display name (so the board shows the real
// name instead of the raw slug). Called by the morning sync; null on any problem.
export async function resolveTournamentTitle(tournament, { query: q = query } = {}) {
  if (!config.startgg.token) return null;
  try {
    const data = await q(HEAD_QUERY, { slug: slugOf(tournament) });
    const name = data?.tournament?.name;
    return name && String(name).trim() ? String(name).trim() : null;
  } catch {
    return null;
  }
}

export { client as startggClient };
