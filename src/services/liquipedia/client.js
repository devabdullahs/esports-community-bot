// HTTP client, request throttle, caches, and search — the network layer.
// No parser or fetcher logic lives here; those modules import parsePage/searchPages from here.

import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { rateState, loadRateState, markRateLimited, saveRateState } from './rateState.js';
import { cleanName, normalizePageUrl } from './parsers.js';

// ---------------------------------------------------------------------------
// Rate-limit configuration
// ---------------------------------------------------------------------------

// PRIMARY (free) data source. Covers VCT, LCS/Worlds, IEM/CS2, RLCS, OWCS, EWC, etc.
//
// Liquipedia API Terms of Use (https://liquipedia.net/api-terms-of-use) REQUIRE:
//   • a descriptive User-Agent identifying the app + contact (set LIQUIPEDIA_USER_AGENT)
//   • action=parse (what we use — "more resource intensive") ≤ 1 request / 30 SECONDS
//   • re-use / cache results as long as possible
// We use the MediaWiki API (action=parse) — NOT raw scraping — and enforce a 30s GLOBAL gap
// between parse requests, a multi-minute response cache (so many matches/polls share one
// fetch), and automatic backoff if Liquipedia rate-limits us anyway.
const PARSE_MIN_GAP_MS = Math.max(30_000, Number(process.env.LIQUIPEDIA_PARSE_MIN_GAP_MS || 30_000));
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.LIQUIPEDIA_CACHE_TTL_MS || 15 * 60_000));
const BACKOFF_MS = Math.max(60_000, Number(process.env.LIQUIPEDIA_BACKOFF_MS || 20 * 60_000));
// Player/page lookup uses action=opensearch (NOT action=parse): it falls under the general
// MediaWiki limit of 1 request / 2s, so it gets its own lighter throttle + cache. We only use it
// to resolve a typed name to its existing page URL — never to fetch or parse the page itself.
const SEARCH_MIN_GAP_MS = Math.max(2_000, Number(process.env.LIQUIPEDIA_SEARCH_MIN_GAP_MS || 2_500));
const SEARCH_CACHE_TTL_MS = Math.max(60_000, Number(process.env.LIQUIPEDIA_SEARCH_CACHE_TTL_MS || 10 * 60_000));
// Cap how many lookups may wait in the serialized search queue at once. Beyond this, extra
// lookups resolve to empty immediately (the command then shows a plain search link) instead of
// queueing without bound — this keeps latency sane and shields us during a usage flood.
const SEARCH_MAX_QUEUE = Math.max(1, Number(process.env.LIQUIPEDIA_SEARCH_MAX_QUEUE || 12));
// Hard ceiling on a single Liquipedia response body, as defense-in-depth against
// a runaway/compromised upstream buffering unbounded bytes into memory (OOM).
// Set FAR above any real response: parse/opensearch payloads are KB to low-MB,
// so 50 MB never rejects a legitimate fetch — it only stops a pathological one.
// The Math.max floor stops a misconfiguration from setting it dangerously low
// (which could otherwise drop real pages and break tracking).
const MAX_RESPONSE_BYTES = Math.max(8 * 1024 * 1024, Number(process.env.LIQUIPEDIA_MAX_RESPONSE_BYTES || 50 * 1024 * 1024));

// ---------------------------------------------------------------------------
// Axios client + caches (ESM singletons — one instance per process)
// ---------------------------------------------------------------------------

const httpClient = axios.create({
  timeout: 20_000,
  maxContentLength: MAX_RESPONSE_BYTES,
  maxBodyLength: MAX_RESPONSE_BYTES,
  headers: { 'User-Agent': config.liquipedia.userAgent, 'Accept-Encoding': 'gzip' },
});

let lastSearchAt = 0;
const cache = new Map(); // key -> { at, data }
const inFlight = new Map(); // key -> Promise<parse response>
const searchCache = new Map(); // `${game}:${q}` -> { at, results }
const searchInFlight = new Map(); // key -> Promise<results>  (dedupe identical concurrent lookups)
let parseChain = Promise.resolve(); // serializes ALL action=parse requests (prevents sleeper bursts)
let parseQueueDepth = 0;
let searchChain = Promise.resolve(); // serializes ALL opensearch requests (prevents bursts)
let searchQueueDepth = 0;
const apiUrl = (game) => `https://liquipedia.net/${game}/api.php`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Throttle
// ---------------------------------------------------------------------------

async function throttleParse() {
  for (;;) {
    loadRateState({ force: true });
    // Honor both the parse sub-limit (1/30s) and the general floor (1/2s)
    // vs any recent search. The persisted timestamp is also shared with
    // Liquipedia-hosted logo downloads, so reload it after each sleep in case
    // another startup queue used the same upstream while this request waited.
    const floor = Math.max(rateState.lastRequestAt + PARSE_MIN_GAP_MS, lastSearchAt + SEARCH_MIN_GAP_MS);
    const wait = floor - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  rateState.lastRequestAt = Date.now();
  saveRateState();
}

function scheduleParse(task) {
  parseQueueDepth++;
  const run = parseChain.then(async () => {
    loadRateState({ force: true });
    if (Date.now() < rateState.blockedUntil) throw new Error('Liquipedia: backing off after a rate limit');
    await throttleParse();
    loadRateState({ force: true });
    if (Date.now() < rateState.blockedUntil) throw new Error('Liquipedia: backing off after a rate limit');
    return task();
  });
  parseChain = run.then(() => undefined, () => undefined); // chain link must never reject
  run.then(() => { parseQueueDepth--; }, () => { parseQueueDepth--; });
  return run;
}

// ---------------------------------------------------------------------------
// parsePage
// ---------------------------------------------------------------------------

// Fetch a page's parsed HTML via the MediaWiki API (throttled, cached, with rate-limit backoff).
// Callers may require a shorter cache age, but every network request still uses
// the same serialized queue and persistent backoff state.
export async function parsePage(game, page, { maxAgeMs = CACHE_TTL_MS } = {}) {
  loadRateState();
  const parsedMaxAge = Number(maxAgeMs);
  const cacheMaxAgeMs = Number.isFinite(parsedMaxAge) ? Math.max(0, parsedMaxAge) : CACHE_TTL_MS;
  const key = `${game}/${page}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheMaxAgeMs) return hit.data;
  if (inFlight.has(key)) return inFlight.get(key);

  // If Liquipedia recently rate-limited us, don't touch the network — serve stale or fail fast.
  if (Date.now() < rateState.blockedUntil) {
    if (hit) return hit.data;
    throw new Error('Liquipedia: backing off after a rate limit');
  }

  const promise = scheduleParse(async () => {
    const afterWait = cache.get(key);
    if (afterWait && Date.now() - afterWait.at < cacheMaxAgeMs) return afterWait.data;

    const { data } = await httpClient.get(apiUrl(game), {
      params: { action: 'parse', page, prop: 'text|displaytitle', format: 'json', redirects: true },
    });
    if (data.error) throw new Error(`Liquipedia: ${data.error.info}`);
    cache.set(key, { at: Date.now(), data });
    return data;
  });

  inFlight.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    const status = err.response?.status;
    const body = typeof err.response?.data === 'string' ? err.response.data : '';
    if (status === 403 || status === 429 || status === 503 || /rate.?limit|cloudflare|temporarily blocked/i.test(body)) {
      markRateLimited(BACKOFF_MS);
      logger.warn(`[liquipedia] rate limited (HTTP ${status ?? '?'}) — pausing requests for ${BACKOFF_MS / 60000} min`);
    }
    if (hit) return hit.data; // prefer stale data over nothing
    throw err;
  } finally {
    inFlight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// searchPages
// ---------------------------------------------------------------------------

// Run a search task on a single serialized queue, spaced ≥ SEARCH_MIN_GAP_MS apart and ≥2s after
// any parse request. This is what makes the lookup safe under load: no matter how many members
// fire /player at once, the actual HTTP requests leave one-at-a-time and never burst past the
// 1-request/2s limit. When the queue is full we reject immediately so the caller falls back to a
// plain search link instead of piling up unbounded work.
function scheduleSearch(task) {
  if (searchQueueDepth >= SEARCH_MAX_QUEUE) return Promise.reject(new Error('search queue full'));
  searchQueueDepth++;
  const run = searchChain.then(async () => {
    for (;;) {
      loadRateState({ force: true });
      const wait = Math.max(lastSearchAt, rateState.lastRequestAt) + SEARCH_MIN_GAP_MS - Date.now();
      if (wait <= 0) break;
      await sleep(wait);
    }
    lastSearchAt = Date.now();
    return task();
  });
  searchChain = run.then(() => undefined, () => undefined); // chain link must never reject
  run.then(() => { searchQueueDepth--; }, () => { searchQueueDepth--; }); // free slot; swallow reject
  return run;
}

// Resolve a typed name to matching Liquipedia pages on a wiki via MediaWiki action=opensearch.
// Returns [{ title, description, url }]. This only FINDS the page (returns its URL) — it never
// fetches or parses the page's content.
//
// Designed to stay ToS-compliant under heavy concurrent use:
//   • Serialized queue (above) → requests never burst, always ≥2.5s apart.
//   • Identical concurrent queries share one in-flight request (dedupe), and results — including
//     empty ones — are cached, so repeated/popular lookups hit memory, not the network.
//   • Never throws: any error / rate-limit backoff / full queue resolves to cached-or-empty, and
//     the command shows a plain Liquipedia search link in that case.
export async function searchPages(game, query, limit = 6) {
  const q = String(query ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!game || !q) return [];
  // Cache/in-flight key must include the limit so a small-limit result isn't served to a caller
  // that asked for more.
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 6));
  const key = `${game}:${q.toLowerCase()}:${normalizedLimit}`;

  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return cached.results;

  loadRateState();
  if (Date.now() < rateState.blockedUntil) return cached ? cached.results : [];
  if (searchInFlight.has(key)) return searchInFlight.get(key); // collapse duplicate concurrent lookups

  const promise = scheduleSearch(async () => {
    // A duplicate may have resolved + cached this while we waited our turn in the queue.
    const fresh = searchCache.get(key);
    if (fresh && Date.now() - fresh.at < SEARCH_CACHE_TTL_MS) return fresh.results;
    if (Date.now() < rateState.blockedUntil) return cached ? cached.results : [];

    const { data } = await httpClient.get(apiUrl(game), {
      params: { action: 'opensearch', search: q, limit: normalizedLimit, namespace: 0, redirects: 'resolve', format: 'json' },
    });
    // opensearch response shape: [query, [titles], [descriptions], [urls]]
    const titles = Array.isArray(data?.[1]) ? data[1] : [];
    const descs = Array.isArray(data?.[2]) ? data[2] : [];
    const urls = Array.isArray(data?.[3]) ? data[3] : [];
    const results = titles
      .map((title, i) => ({
        title: cleanName(title),
        description: cleanName(descs[i]) || null,
        url: normalizePageUrl(urls[i]) || searchPageUrl(game, title),
      }))
      .filter((r) => r.title && r.url);
    searchCache.set(key, { at: Date.now(), results });
    return results;
  })
    .catch((err) => {
      const status = err.response?.status;
      if (status === 403 || status === 429 || status === 503) {
        markRateLimited(BACKOFF_MS);
        logger.warn(`[liquipedia] search rate limited (HTTP ${status}) — pausing requests for ${BACKOFF_MS / 60000} min`);
      } else if (err.message !== 'search queue full') {
        logger.debug(`[liquipedia] search failed (${key}): ${err.message}`);
      }
      return cached ? cached.results : []; // graceful fallback; command shows a search link
    })
    .finally(() => {
      searchInFlight.delete(key);
    });

  searchInFlight.set(key, promise);
  return promise;
}

// Like searchPages, but reports whether the (possibly empty) result came from a
// SUCCESSFUL search. Successful searches cache their results — including empty
// ones — while every failure path (backoff, HTTP error, full queue) returns
// uncached. ok=false therefore means "transient, retry later"; ok=true with no
// results means "this name genuinely has no matches" and may be TTL-stamped.
export async function searchPagesStrict(game, query, limit = 6) {
  const results = await searchPages(game, query, limit);
  if (results.length) return { ok: true, results };
  const q = String(query ?? '').trim().replace(/\s+/g, ' ');
  if (!game || !q) return { ok: true, results: [] };
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 6));
  const key = `${game}:${q.toLowerCase()}:${normalizedLimit}`;
  const cached = searchCache.get(key);
  return { ok: Boolean(cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS), results };
}

// A plain Liquipedia search-results URL (zero API calls) — used as a fallback when opensearch
// finds nothing or is unavailable.
export function searchPageUrl(game, query) {
  return `https://liquipedia.net/${game}/index.php?title=Special:Search&fulltext=1&search=${encodeURIComponent(String(query ?? ''))}`;
}
