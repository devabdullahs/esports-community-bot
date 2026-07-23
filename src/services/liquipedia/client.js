// HTTP client, request scheduler, caches, and search - the network layer.
// No parser or fetcher logic lives here; those modules import parsePage/searchPages from here.

import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { rateState, loadRateState, markRateLimited, saveRateState } from './rateState.js';
import { cleanName, normalizePageUrl } from './parsers.js';
import { createLiquipediaRequestScheduler, LIQUIPEDIA_BACKOFF_ERROR_MESSAGE } from './scheduler.js';

// Liquipedia action=parse requests remain at least 30 seconds apart. Searches
// use the general MediaWiki request floor, deliberately set above the 2s limit.
const PARSE_MIN_GAP_MS = Math.max(30_000, Number(process.env.LIQUIPEDIA_PARSE_MIN_GAP_MS || 30_000));
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.LIQUIPEDIA_CACHE_TTL_MS || 15 * 60_000));
const BACKOFF_MS = Math.max(60_000, Number(process.env.LIQUIPEDIA_BACKOFF_MS || 20 * 60_000));
const SEARCH_MIN_GAP_MS = Math.max(2_500, Number(process.env.LIQUIPEDIA_SEARCH_MIN_GAP_MS || 2_500));
const SEARCH_CACHE_TTL_MS = Math.max(60_000, Number(process.env.LIQUIPEDIA_SEARCH_CACHE_TTL_MS || 10 * 60_000));
const SEARCH_MAX_QUEUE = Math.max(1, Number(process.env.LIQUIPEDIA_SEARCH_MAX_QUEUE || 12));
const MAX_RESPONSE_BYTES = Math.max(8 * 1024 * 1024, Number(process.env.LIQUIPEDIA_MAX_RESPONSE_BYTES || 50 * 1024 * 1024));

const httpClient = axios.create({
  timeout: 20_000,
  maxContentLength: MAX_RESPONSE_BYTES,
  maxBodyLength: MAX_RESPONSE_BYTES,
  headers: { 'User-Agent': config.liquipedia.userAgent, 'Accept-Encoding': 'gzip' },
});

const apiUrl = (game) => `https://liquipedia.net/${game}/api.php`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLiquipediaClient({
  http = httpClient,
  apiUrlForGame = apiUrl,
  now = () => Date.now(),
  sleep: sleepFor = sleep,
  rateState: schedulerRateState = rateState,
  loadRateState: loadSchedulerRateState = loadRateState,
  saveRateState: saveSchedulerRateState = saveRateState,
  markRateLimited: markSchedulerRateLimited = markRateLimited,
  log = logger,
  parseMinGapMs = PARSE_MIN_GAP_MS,
  searchMinGapMs = SEARCH_MIN_GAP_MS,
  cacheTtlMs = CACHE_TTL_MS,
  searchCacheTtlMs = SEARCH_CACHE_TTL_MS,
  searchMaxQueue = SEARCH_MAX_QUEUE,
  backoffMs = BACKOFF_MS,
} = {}) {
  const cache = new Map(); // key -> { at, data }
  const inFlight = new Map(); // key -> Promise<parse response>
  const searchCache = new Map(); // `${game}:${q}` -> { at, results }
  const searchInFlight = new Map(); // key -> Promise<results>
  const scheduler = createLiquipediaRequestScheduler({
    rateState: schedulerRateState,
    loadRateState: loadSchedulerRateState,
    saveRateState: saveSchedulerRateState,
    parseMinGapMs,
    searchMinGapMs,
    now,
    sleep: sleepFor,
  });
  let searchQueueDepth = 0;

  function isRateLimited(error) {
    const status = error.response?.status;
    const body = typeof error.response?.data === 'string' ? error.response.data : '';
    return status === 403 || status === 429 || status === 503 || /rate.?limit|cloudflare|temporarily blocked/i.test(body);
  }

  function markRateLimitedError(error) {
    if (!isRateLimited(error)) return false;
    const status = error.response?.status;
    markSchedulerRateLimited(backoffMs);
    log.warn(`[liquipedia] rate limited (HTTP ${status ?? '?'}) - pausing requests for ${backoffMs / 60000} min`);
    return true;
  }

  function scheduleSearch(task) {
    if (searchQueueDepth >= searchMaxQueue) return Promise.reject(new Error('search queue full'));
    searchQueueDepth++;
    const run = scheduler.schedule('search', task);
    run.then(() => { searchQueueDepth--; }, () => { searchQueueDepth--; });
    return run;
  }

  // Fetch parsed HTML via MediaWiki with persistent pacing, cache, and backoff.
  async function parsePage(game, page, { maxAgeMs = cacheTtlMs } = {}) {
    loadSchedulerRateState();
    const parsedMaxAge = Number(maxAgeMs);
    const cacheMaxAgeMs = Number.isFinite(parsedMaxAge) ? Math.max(0, parsedMaxAge) : cacheTtlMs;
    const key = `${game}/${page}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMaxAgeMs) return hit.data;
    if (inFlight.has(key)) return inFlight.get(key);

    if (now() < schedulerRateState.blockedUntil) {
      if (hit) return hit.data;
      throw new Error(LIQUIPEDIA_BACKOFF_ERROR_MESSAGE);
    }

    const promise = scheduler.schedule('parse', async () => {
      const afterWait = cache.get(key);
      if (afterWait && now() - afterWait.at < cacheMaxAgeMs) return afterWait.data;

      const { data } = await http.get(apiUrlForGame(game), {
        params: { action: 'parse', page, prop: 'text|displaytitle', format: 'json', redirects: true },
      });
      if (data.error) throw new Error(`Liquipedia: ${data.error.info}`);
      cache.set(key, { at: now(), data });
      return data;
    });

    inFlight.set(key, promise);
    try {
      return await promise;
    } catch (err) {
      markRateLimitedError(err);
      if (hit) return hit.data; // prefer stale data over nothing
      throw err;
    } finally {
      inFlight.delete(key);
    }
  }

  // Resolve a typed name to matching Liquipedia pages via MediaWiki opensearch.
  // It never fetches or parses the matching page itself.
  async function searchPages(game, query, limit = 6) {
    const q = String(query ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!game || !q) return [];
    const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 6));
    const key = `${game}:${q.toLowerCase()}:${normalizedLimit}`;

    const cached = searchCache.get(key);
    if (cached && now() - cached.at < searchCacheTtlMs) return cached.results;

    loadSchedulerRateState();
    if (now() < schedulerRateState.blockedUntil) return cached ? cached.results : [];
    if (searchInFlight.has(key)) return searchInFlight.get(key); // collapse duplicate concurrent lookups

    const promise = scheduleSearch(async () => {
      // A duplicate may have resolved and cached while this request waited.
      const fresh = searchCache.get(key);
      if (fresh && now() - fresh.at < searchCacheTtlMs) return fresh.results;
      if (now() < schedulerRateState.blockedUntil) return cached ? cached.results : [];

      const { data } = await http.get(apiUrlForGame(game), {
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
        .filter((result) => result.title && result.url);
      searchCache.set(key, { at: now(), results });
      return results;
    })
      .catch((err) => {
        if (!markRateLimitedError(err) && err.message !== 'search queue full' && err.message !== LIQUIPEDIA_BACKOFF_ERROR_MESSAGE) {
          log.debug('[liquipedia] search failed');
        }
        return cached ? cached.results : []; // graceful fallback; command shows a search link
      })
      .finally(() => {
        searchInFlight.delete(key);
      });

    searchInFlight.set(key, promise);
    return promise;
  }

  // Successful searches cache empty results too; failures remain retryable.
  async function searchPagesStrict(game, query, limit = 6) {
    const results = await searchPages(game, query, limit);
    if (results.length) return { ok: true, results };
    const q = String(query ?? '').trim().replace(/\s+/g, ' ');
    if (!game || !q) return { ok: true, results: [] };
    const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 6));
    const key = `${game}:${q.toLowerCase()}:${normalizedLimit}`;
    const cached = searchCache.get(key);
    return { ok: Boolean(cached && now() - cached.at < searchCacheTtlMs), results };
  }

  return { parsePage, searchPages, searchPagesStrict };
}

const defaultClient = createLiquipediaClient();

export const { parsePage, searchPages, searchPagesStrict } = defaultClient;

// A plain Liquipedia search-results URL (zero API calls) for graceful fallbacks.
export function searchPageUrl(game, query) {
  return `https://liquipedia.net/${game}/index.php?title=Special:Search&fulltext=1&search=${encodeURIComponent(String(query ?? ''))}`;
}
