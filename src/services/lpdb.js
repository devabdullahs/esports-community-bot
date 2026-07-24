import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { loadLpdbRateState, saveLpdbRateState } from './lpdbRateState.js';

// LiquipediaDB (LPDB) API v3 requires an approved API key and permits no more
// than 60 requests per hour. Every request therefore uses this one 65-second queue.
const MIN_GAP_MS = 65_000;
const CACHE_TTL_MS = 5 * 60_000;
const STALE_CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const DEFAULT_BACKOFF_MS = boundedMs(process.env.LPDB_BACKOFF_MS, 20 * 60_000);
const RATE_LIMIT_STATUSES = new Set([403, 429, 503]);

const client = axios.create({
  baseURL: config.lpdb.baseUrl,
  timeout: 20_000,
  headers: {
    'User-Agent': config.liquipedia.userAgent,
    'Accept-Encoding': 'gzip',
    ...(config.lpdb.apiKey ? { Authorization: `Apikey ${config.lpdb.apiKey}` } : {}),
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

function boundedMs(value, fallback) {
  const parsed = Number(value);
  const ms = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, ms));
}

function stateFrom(value) {
  const timestamp = (candidate) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    lastRequestAt: timestamp(value?.lastRequestAt),
    blockedUntil: timestamp(value?.blockedUntil),
  };
}

function retryAfterMs(headers, at) {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const seconds = Number(value);
  const candidate = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - at;
  return Number.isFinite(candidate) && candidate >= 0 ? boundedMs(candidate, MIN_BACKOFF_MS) : null;
}

function rateLimitStatus(error) {
  const status = Number(error?.response?.status);
  return RATE_LIMIT_STATUSES.has(status) ? status : null;
}

export class LpdbError extends Error {
  constructor(code, message, { cause, status } = {}) {
    super(message);
    this.name = 'LpdbError';
    this.code = code;
    if (cause) this.cause = cause;
    if (status) this.status = status;
  }
}

export function isLpdbProviderBlock(error) {
  return error instanceof LpdbError && ['backoff', 'rate_limited', 'truncated'].includes(error.code);
}

function toSec(dateStr) {
  if (!dateStr || /^0000/.test(dateStr)) return null;
  const t = Date.parse(dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

// Normalize an LPDB match2 record into the bot's standard match shape.
export function normalize(m, wiki) {
  const opps = m.match2opponents || [];
  const nameOf = (o) => (o?.name || o?.template || 'TBD').replace(/_/g, ' ').trim();
  const scoreOf = (o) => {
    const s = Number(o?.score);
    return Number.isFinite(s) && s >= 0 ? s : null;
  };
  const teamA = nameOf(opps[0]);
  const teamB = nameOf(opps[1]);
  const scoreA = scoreOf(opps[0]);
  const scoreB = scoreOf(opps[1]);
  const scheduledAt = toSec(m.date);
  const finished = Number(m.finished) === 1;
  const winnerIdx = Number(m.winner);

  let status = 'scheduled';
  if (finished) status = 'finished';
  else if ((scoreA ?? 0) + (scoreB ?? 0) > 0) status = 'running';
  else if (scheduledAt && nowSec() >= scheduledAt && nowSec() - scheduledAt <= 4 * 3600) status = 'running';

  return {
    source: 'liquipedia',
    externalId: m.match2id || m.objectname || `lpdb:${wiki}:${teamA}:${teamB}:${scheduledAt}`,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    scoreA,
    scoreB,
    bestOf: Number(m.bestof) || null,
    scheduledAt,
    status,
    winner: finished && (winnerIdx === 1 || winnerIdx === 2) ? (winnerIdx === 1 ? teamA : teamB) : null,
  };
}

export function scheduleConditions(page) {
  const normalized = String(page || '').trim().replace(/^\/+|\/+$/g, '').replace(/ /g, '_');
  if (!normalized || /[\[\]\r\n]/.test(normalized)) return null;

  // Liquipedia stores tournament matches under the infobox `parent` value.
  // `pagename` only describes the page where a particular match widget was
  // rendered, so querying it alone returns an incomplete schedule whenever a
  // stage is transcluded from a child page.
  return `[[parent::${normalized}]] OR [[pagename::${normalized}]]`;
}

function normalizeSchedule(rows, wiki) {
  const seen = new Set();
  return rows
    .map((m) => normalize(m, wiki))
    .filter((m) => (m.teamA !== 'TBD' || m.teamB !== 'TBD') && !seen.has(m.externalId) && seen.add(m.externalId));
}

function tournamentQuery(tournament) {
  const [wiki, ...rest] = String(tournament?.external_id || '').split('/');
  const page = rest.join('/');
  const conditions = scheduleConditions(page);
  return wiki && page && conditions ? { wiki, conditions } : null;
}

export function createLpdbClient({
  http = client,
  now = Date.now,
  sleep: pause = sleep,
  loadRateState = loadLpdbRateState,
  saveRateState = saveLpdbRateState,
  minGapMs = MIN_GAP_MS,
  cacheTtlMs = CACHE_TTL_MS,
  staleCacheTtlMs = STALE_CACHE_TTL_MS,
  maxCacheEntries = MAX_CACHE_ENTRIES,
  pageLimit = PAGE_LIMIT,
  maxPages = MAX_PAGES,
  backoffMs = DEFAULT_BACKOFF_MS,
} = {}) {
  if (!http || typeof http.get !== 'function') throw new TypeError('LPDB client needs http.get');

  const cache = new Map();
  const inFlight = new Map();
  let requestChain = Promise.resolve();

  const readState = () => stateFrom(loadRateState());
  const writeState = (state) => saveRateState(stateFrom(state));

  function pruneCache(at) {
    for (const [key, entry] of cache) {
      if (at - entry.at > staleCacheTtlMs) cache.delete(key);
    }
    while (cache.size > maxCacheEntries) {
      let oldestKey;
      let oldestAt = Infinity;
      for (const [key, entry] of cache) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }

  async function admitRequest() {
    for (;;) {
      const state = readState();
      const at = now();
      if (at < state.blockedUntil) throw new LpdbError('backoff', 'LPDB schedule requests are temporarily blocked');
      const wait = state.lastRequestAt + minGapMs - at;
      if (wait > 0) {
        await pause(wait);
        continue;
      }

      // A different process may have persisted a newer timestamp while this
      // request waited, so reload once more before making the request visible.
      const finalState = readState();
      const finalAt = now();
      if (finalAt < finalState.blockedUntil) throw new LpdbError('backoff', 'LPDB schedule requests are temporarily blocked');
      const finalWait = finalState.lastRequestAt + minGapMs - finalAt;
      if (finalWait > 0) {
        await pause(finalWait);
        continue;
      }
      writeState({ lastRequestAt: finalAt, blockedUntil: finalState.blockedUntil });
      return;
    }
  }

  function scheduleRequest(task) {
    const run = requestChain.then(async () => {
      await admitRequest();
      return task();
    });
    requestChain = run.then(() => undefined, () => undefined);
    return run;
  }

  function markRateLimited(error) {
    const status = rateLimitStatus(error);
    if (!status) return null;
    const state = readState();
    const at = now();
    const delay = retryAfterMs(error.response?.headers, at) ?? boundedMs(backoffMs, DEFAULT_BACKOFF_MS);
    writeState({ lastRequestAt: state.lastRequestAt, blockedUntil: Math.max(state.blockedUntil, at + delay) });
    logger.warn(`[lpdb] upstream rate limited (HTTP ${status}); pausing schedule requests`);
    return new LpdbError('rate_limited', 'LPDB schedule requests are temporarily blocked', { cause: error, status });
  }

  function classifyError(error) {
    if (error instanceof LpdbError) return error;
    const rateLimited = markRateLimited(error);
    if (rateLimited) return rateLimited;
    return new LpdbError('request_failed', 'LPDB schedule request failed', {
      cause: error,
      status: Number(error?.response?.status) || undefined,
    });
  }

  async function fetchPage(wiki, conditions, offset) {
    const { data } = await scheduleRequest(async () => {
      try {
        return await http.get('/match', {
          params: { wiki, conditions, limit: pageLimit, offset, order: 'date ASC' },
        });
      } catch (error) {
        const rateLimited = markRateLimited(error);
        throw rateLimited || error;
      }
    });
    const result = data?.result ?? data?.[0]?.result;
    if (!Array.isArray(result)) throw new LpdbError('malformed_response', 'LPDB returned malformed schedule data');
    return result;
  }

  function queryMatches(wiki, conditions) {
    const key = `${wiki}|${conditions}`;
    const at = now();
    pruneCache(at);
    const hit = cache.get(key);
    if (hit && at - hit.at < cacheTtlMs) return Promise.resolve(hit.data);
    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      try {
        const state = readState();
        if (now() < state.blockedUntil) {
          if (hit) return hit.data;
          throw new LpdbError('backoff', 'LPDB schedule requests are temporarily blocked');
        }

        const rows = [];
        for (let page = 0; page < maxPages; page++) {
          const next = await fetchPage(wiki, conditions, page * pageLimit);
          rows.push(...next);
          if (next.length < pageLimit) {
            cache.set(key, { at: now(), data: rows });
            pruneCache(now());
            return rows;
          }
          if (next.length > pageLimit) {
            throw new LpdbError('malformed_response', 'LPDB returned an oversized schedule page');
          }
        }
        throw new LpdbError('truncated', 'LPDB schedule pagination reached its safety limit');
      } catch (error) {
        const typed = classifyError(error);
        if (isLpdbProviderBlock(typed) && hit) return hit.data;
        throw typed;
      }
    })();

    inFlight.set(key, promise);
    promise.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    );
    return promise;
  }

  return {
    fetchSchedule(tournament) {
      const query = tournamentQuery(tournament);
      if (!query) return Promise.resolve([]);
      return queryMatches(query.wiki, query.conditions).then((rows) => normalizeSchedule(rows, query.wiki));
    },
    queryMatches,
  };
}

const lpdbClient = createLpdbClient();

export function isEnabled() {
  return Boolean(config.lpdb.apiKey);
}

// Matches for a tracked tournament via LPDB (external_id = "<wiki>/<Page_Path>").
export function fetchSchedule(tournament) {
  return lpdbClient.fetchSchedule(tournament);
}
