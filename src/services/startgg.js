import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { gameSlugFromName } from '../lib/games.js';

// Start.gg GraphQL API (free tier). Best for FGC / community brackets hosted on start.gg.
// Docs: https://developer.start.gg/docs/intro
// start.gg's GraphQL is slow and bursty: under load it throws timeouts and a generic
// "An unknown error has occurred" that is almost always transient. A single sync fires
// several sequential requests, so use a generous timeout and retry transient failures
// with backoff — a hiccup shouldn't zero out the whole tournament's sync.
const REQUEST_TIMEOUT_MS = 25_000;
const client = axios.create({
  baseURL: config.startgg.baseUrl,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    ...(config.startgg.token ? { Authorization: `Bearer ${config.startgg.token}` } : {}),
  },
});

// Transient = worth retrying the SAME request. Deterministic GraphQL errors
// (complexity, validation) are NOT transient — they bubble up so the caller can
// shrink the page size instead.
const TRANSIENT_RE = /timeout|an unknown error has occurred|temporarily|service unavailable|bad gateway|gateway timeout/i;
function isTransient(e) {
  const code = e?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
  const status = e?.response?.status;
  if (status === 429) return true; // rate limited — back off and retry
  if (typeof status === 'number' && status >= 500) return true;
  return TRANSIENT_RE.test(e?.message ?? '');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function query(gql, variables = {}, { retries = 3, delayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const { data } = await client.post('', { query: gql, variables });
      // GraphQL errors (complexity, bad query) are deterministic — surface them now, don't retry.
      if (data.errors) throw new Error(data.errors.map((e) => e.message).join('; '));
      return data.data;
    } catch (e) {
      if (!isTransient(e) || attempt === retries) throw e;
      lastErr = e;
      logger.debug(`[startgg] transient error (attempt ${attempt}/${retries}): ${e.message}; retrying`);
      if (delayMs) await sleep(delayMs * attempt);
    }
  }
  throw lastErr;
}

// external_id is the tournament slug ("rlcs-2026-mena-1v1-open"), an already
// full "tournament/<slug>" path, or an event-scoped
// "tournament/<slug>/event/<event-slug>" path.
function slugOf(tournament) {
  const raw = String(tournament?.external_id ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  return /^tournament\//i.test(raw) ? raw : `tournament/${raw}`;
}

function isEventSlug(slug) {
  return /\/event\/[^/]+$/i.test(slug);
}

// Lightweight: the tournament's display name, its event ids, and each event's game.
// One cheap request that drives the title + game resolvers and the per-event walk below.
const HEAD_QUERY = `query Head($slug: String!) {
  tournament(slug: $slug) { name events { id name videogame { name } } }
}`;

// Event-scoped URLs are important for multi-game tournaments such as Evo. Without
// this path, adding /event/tekken-8 imports every Evo event instead of just Tekken.
const EVENT_HEAD_QUERY = `query EventHead($slug: String!) {
  event(slug: $slug) { id name videogame { name } tournament { name } }
}`;

// One PAGE of an event's sets, filtered by lifecycle state and sorted as the caller asks.
const EVENT_SETS_QUERY = `query EventSets($eventId: ID!, $page: Int!, $perPage: Int!, $sortType: SetSortType!, $state: [Int!]) {
  event(id: $eventId) {
    sets(page: $page, perPage: $perPage, sortType: $sortType, filters: { state: $state }) {
      pageInfo { totalPages }
      nodes {
        id state startAt winnerId
        slots { entrant { id name } standing { stats { score { value } } } }
      }
    }
  }
}`;

// We do NOT pull a whole event — start.gg "open" events carry tens of thousands of
// qualifier sets (one RL 1v1 Open had 22,182 across 444 pages). We also can't just take
// the most-RECENT sets: RECENT is dominated by just-FINISHED matches, so the live and
// upcoming matches the boards actually show would never come through. Instead fetch a
// bounded window PER lifecycle state — live now, then next-up, then a tail of recent
// results. start.gg set states: 1 = not started, 2 = in progress, 3 = completed.
const STATE_WINDOWS = [
  { state: 2, sortType: 'STANDARD', cap: 60 }, // live now
  { state: 1, sortType: 'STANDARD', cap: 60 }, // upcoming / next up
  { state: 3, sortType: 'RECENT', cap: 40 }, // recent results
];
const SETS_PER_PAGE = 50;
const PAGE_SIZE_LADDER = [SETS_PER_PAGE, 25, 12];

function cleanName(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

async function fetchHead(tournament, q) {
  const slug = slugOf(tournament);
  if (!slug) return { tournamentName: null, eventName: null, events: [] };

  if (isEventSlug(slug)) {
    const data = await q(EVENT_HEAD_QUERY, { slug });
    const event = data?.event;
    if (!event?.id) return { tournamentName: null, eventName: null, events: [] };
    return {
      tournamentName: event?.tournament?.name ?? null,
      eventName: event?.name ?? null,
      events: [{ id: event.id, name: event.name, videogame: event.videogame ?? null }],
    };
  }

  const data = await q(HEAD_QUERY, { slug });
  return {
    tournamentName: data?.tournament?.name ?? null,
    eventName: null,
    events: data?.tournament?.events ?? [],
  };
}

function displayNameFromHead(head) {
  const tournamentName = cleanName(head?.tournamentName);
  const eventName = cleanName(head?.eventName);
  if (eventName) return tournamentName ? `${tournamentName}: ${eventName}` : eventName;
  return tournamentName;
}

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

// One lifecycle window of an event's sets, paginated up to its cap. On a start.gg
// complexity error, restart the window at a smaller page size (cleaner than mixing
// page sizes mid-walk). Small events return all their sets in a window; huge ones
// stop at the cap, so we never page deep into qualifier brackets.
async function fetchWindow(eventId, q, { state, sortType, cap }) {
  for (const perPage of PAGE_SIZE_LADDER) {
    try {
      const nodes = [];
      const maxPages = Math.ceil(cap / perPage);
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= maxPages && nodes.length < cap) {
        const data = await q(EVENT_SETS_QUERY, { eventId, page, perPage, sortType, state: [state] });
        const conn = data?.event?.sets;
        totalPages = Number(conn?.pageInfo?.totalPages) || 1;
        for (const node of conn?.nodes ?? []) nodes.push(node);
        page += 1;
      }
      return nodes.slice(0, cap);
    } catch (e) {
      if (/complexity/i.test(e.message) && perPage > PAGE_SIZE_LADDER[PAGE_SIZE_LADDER.length - 1]) {
        logger.debug(`[startgg] event ${eventId} state ${state} too complex at perPage ${perPage}; retrying smaller`);
        continue;
      }
      throw e;
    }
  }
  return [];
}

// The tracked sets for one event: live + upcoming + a tail of recent results.
async function fetchEventSets(eventId, q) {
  const out = [];
  for (const window of STATE_WINDOWS) {
    const nodes = await fetchWindow(eventId, q, window);
    for (const node of nodes) out.push(node);
  }
  return out;
}

// One set's current state, fetched DIRECTLY by id. The windowed fetchSchedule can't
// include every set of a huge open, so the live-poller uses this to finalize a
// specific tracked match it can't find in the window. externalId is `sgg:<setId>`.
const SET_QUERY = `query Set($id: ID!) {
  set(id: $id) {
    id state startAt winnerId
    slots { entrant { id name } standing { stats { score { value } } } }
  }
}`;

export async function fetchMatch(externalId, { query: q = query } = {}) {
  if (!config.startgg.token) return null;
  const id = String(externalId ?? '').replace(/^sgg:/i, '');
  if (!id) return null;
  const data = await q(SET_QUERY, { id });
  return data?.set ? normalizeSet(data.set) : null;
}

// The tracked matches (sets) for a start.gg tournament: live + upcoming + recent
// results per event (see STATE_WINDOWS), deduped across events.
// `query` is injectable for tests (no network).
export async function fetchSchedule(tournament, { query: q = query } = {}) {
  if (!config.startgg.token) {
    logger.warn('[startgg] STARTGG_TOKEN not set — skipping.');
    return [];
  }
  const head = await fetchHead(tournament, q);
  const events = head.events ?? [];

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
    return displayNameFromHead(await fetchHead(tournament, q));
  } catch {
    return null;
  }
}

// Auto-detect the tracked tournament's game from start.gg's videogame metadata, mapped
// to the bot's game slug (e.g. "Rocket League" → "rocketleague"). start.gg URLs don't
// encode the game the way Liquipedia's do, so without this a start.gg tournament has
// game=null and never groups under its game's board. null on any problem.
export async function resolveTournamentGame(tournament, { query: q = query } = {}) {
  if (!config.startgg.token) return null;
  try {
    const head = await fetchHead(tournament, q);
    for (const ev of head.events ?? []) {
      const slug = gameSlugFromName(ev?.videogame?.name);
      if (slug) return slug;
    }
    return null;
  } catch {
    return null;
  }
}

export { client as startggClient, STATE_WINDOWS };
