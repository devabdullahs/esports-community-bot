import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { formatLiquipediaPageTitle } from '../lib/parseTournamentInput.js';
import { normalizeTeamName } from '../lib/render.js';
import * as lpdb from './lpdb.js';
import { rateState, loadRateState, saveRateState } from './liquipedia/rateState.js';
import {
  cleanName,
  normalizePageUrl,
  parseMatchInfo,
  parseBracketMatch,
  parseMatchlistMatch,
  parseSwissMatches,
  parseClubStandings,
  parseClubPrizepool,
  parseEwcClubs,
  parseEwcPlayerList,
  parseEwcEventSchedule,
  VRS_REGIONS,
  valveRankingRegions,
  normalizeValveRankingRegion,
  parseValveRankingTable,
} from './liquipedia/parsers.js';

// Re-export parser functions so importers of this facade get the same public API.
export {
  parseMatchInfo,
  parseBracketMatch,
  parseMatchlistMatch,
  parseSwissMatches,
  parseClubStandings,
  parseClubPrizepool,
  parseEwcClubs,
  parseEwcPlayerList,
  parseEwcEventSchedule,
};

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
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.LIQUIPEDIA_CACHE_TTL_MS || 5 * 60_000));
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

const client = axios.create({
  timeout: 20_000,
  headers: { 'User-Agent': config.liquipedia.userAgent, 'Accept-Encoding': 'gzip' },
});

let lastSearchAt = 0;
const cache = new Map(); // key -> { at, data }
const inFlight = new Map(); // key -> Promise<parse response>
const searchCache = new Map(); // `${game}:${q}` -> { at, results }
const searchInFlight = new Map(); // key -> Promise<results>  (dedupe identical concurrent lookups)
let searchChain = Promise.resolve(); // serializes ALL opensearch requests (prevents bursts)
let searchQueueDepth = 0;
const apiUrl = (game) => `https://liquipedia.net/${game}/api.php`;
const normPath = (s) => decodeURIComponent(String(s ?? '')).toLowerCase();

async function throttle() {
  loadRateState();
  // Honor both the parse sub-limit (1/30s) and the general floor (1/2s) vs any recent search.
  const floor = Math.max(rateState.lastRequestAt + PARSE_MIN_GAP_MS, lastSearchAt + SEARCH_MIN_GAP_MS);
  const wait = floor - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  rateState.lastRequestAt = Date.now();
  saveRateState();
}

// Fetch a page's parsed HTML via the MediaWiki API (throttled, cached, with rate-limit backoff).
export async function parsePage(game, page) {
  loadRateState();
  const key = `${game}/${page}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  if (inFlight.has(key)) return inFlight.get(key);

  // If Liquipedia recently rate-limited us, don't touch the network — serve stale or fail fast.
  if (Date.now() < rateState.blockedUntil) {
    if (hit) return hit.data;
    throw new Error('Liquipedia: backing off after a rate limit');
  }

  const promise = (async () => {
    await throttle();
    const afterWait = cache.get(key);
    if (afterWait && Date.now() - afterWait.at < CACHE_TTL_MS) return afterWait.data;

    const { data } = await client.get(apiUrl(game), {
      params: { action: 'parse', page, prop: 'text|displaytitle', format: 'json', redirects: true },
    });
    if (data.error) throw new Error(`Liquipedia: ${data.error.info}`);
    cache.set(key, { at: Date.now(), data });
    return data;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    const status = err.response?.status;
    const body = typeof err.response?.data === 'string' ? err.response.data : '';
    if (status === 403 || status === 429 || status === 503 || /rate.?limit|cloudflare|temporarily blocked/i.test(body)) {
      rateState.blockedUntil = Date.now() + BACKOFF_MS;
      saveRateState();
      logger.warn(`[liquipedia] rate limited (HTTP ${status ?? '?'}) — pausing requests for ${BACKOFF_MS / 60000} min`);
    }
    if (hit) return hit.data; // prefer stale data over nothing
    throw err;
  } finally {
    inFlight.delete(key);
  }
}

// Run a search task on a single serialized queue, spaced ≥ SEARCH_MIN_GAP_MS apart and ≥2s after
// any parse request. This is what makes the lookup safe under load: no matter how many members
// fire /player at once, the actual HTTP requests leave one-at-a-time and never burst past the
// 1-request/2s limit. When the queue is full we reject immediately so the caller falls back to a
// plain search link instead of piling up unbounded work.
function scheduleSearch(task) {
  if (searchQueueDepth >= SEARCH_MAX_QUEUE) return Promise.reject(new Error('search queue full'));
  searchQueueDepth++;
  const run = searchChain.then(async () => {
    const wait = Math.max(lastSearchAt, rateState.lastRequestAt) + SEARCH_MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
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

    const { data } = await client.get(apiUrl(game), {
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
        rateState.blockedUntil = Date.now() + BACKOFF_MS;
        saveRateState();
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

// A plain Liquipedia search-results URL (zero API calls) — used as a fallback when opensearch
// finds nothing or is unavailable.
export function searchPageUrl(game, query) {
  return `https://liquipedia.net/${game}/index.php?title=Special:Search&fulltext=1&search=${encodeURIComponent(String(query ?? ''))}`;
}

function cleanDisplayTitle(title) {
  if (!title) return null;
  const text = /</.test(title) ? cheerio.load(`<main>${title}</main>`)('main').text() : title;
  return text.replace(/\s+/g, ' ').trim() || null;
}

export async function resolveTournamentTitle(tournament) {
  const [game, ...rest] = tournament.external_id.split('/');
  const page = rest.join('/');
  if (!page) return null;

  const data = await parsePage(game, page);
  const title = cleanDisplayTitle(data?.parse?.displaytitle) || cleanDisplayTitle(data?.parse?.title);
  return title && !title.includes('/') ? title : formatLiquipediaPageTitle(page);
}

// All matches currently in a game's matchticker (upcoming/ongoing/recent).
export async function fetchGameMatches(game) {
  const data = await parsePage(game, 'Main_Page');
  const html = data?.parse?.text?.['*'];
  if (!html) return [];
  const $ = cheerio.load(html);
  return $('.match-info')
    .toArray()
    .map((el) => parseMatchInfo($, el, game))
    .filter((m) => m.teamA !== 'TBD' || m.teamB !== 'TBD');
}

// Matches for a tracked tournament, parsed from its OWN page's bracket/matchlist
// (external_id = "<game>/<Page_Path>"). Stable + authoritative: upcoming, live, and finished
// (with final scores + winners), so results are correct and corrections propagate.
export async function fetchSchedule(tournament) {
  const [game, ...rest] = tournament.external_id.split('/');
  const page = rest.join('/');
  if (!page) return [];

  // Prefer the structured LPDB API when a key is configured; fall back to HTML parsing on any
  // error or empty result, so enabling LPDB can never break tracking.
  if (lpdb.isEnabled()) {
    try {
      const viaApi = await lpdb.fetchSchedule(tournament);
      if (viaApi.length) return viaApi;
      logger.debug(`[lpdb] no matches for ${tournament.external_id}; using HTML parse`);
    } catch (e) {
      logger.warn(`[lpdb] ${tournament.external_id} failed, using HTML parse: ${e.message}`);
    }
  }

  const data = await parsePage(game, page);
  const html = data?.parse?.text?.['*'];
  if (!html) return [];
  const $ = cheerio.load(html);

  const out = [];
  const seenIds = new Set();
  const pairIndex = new Map(); // pairKey -> match (dedupe + live-status upgrade)
  const pairOf = (m) => [normalizeTeamName(m.teamA), normalizeTeamName(m.teamB)].sort().join('|');
  const addAuthoritative = (el, parser) => {
    const m = parser($, el, game, page);
    if (!m || seenIds.has(m.externalId)) return;
    seenIds.add(m.externalId);
    pairIndex.set(pairOf(m), m);
    out.push(m);
  };

  // 1) Brackets AND match lists (group / Swiss / weekly schedules) = authoritative:
  //    stable set, with winners + final scores.
  $('.brkts-match').each((_i, el) => addAuthoritative(el, parseBracketMatch));
  $('.brkts-matchlist-match').each((_i, el) => addAuthoritative(el, parseMatchlistMatch));

  // 1c) Swiss group standings grids (RLCS etc.) — matches are encoded in the round cells.
  for (const m of parseSwissMatches($, game)) {
    if (seenIds.has(m.externalId) || pairIndex.has(pairOf(m))) continue;
    seenIds.add(m.externalId);
    pairIndex.set(pairOf(m), m);
    out.push(m);
  }

  // 2) "Upcoming Matches" widget = the live matchticker, our best LIVE signal. For a pair we
  //    already have, don't duplicate it — but if the widget shows it live, UPGRADE the stored
  //    entry to running. (A Swiss/bracket cell can show a live Bo3's partial score, e.g. 1-0,
  //    which the score heuristic otherwise reads as "finished".) New matchups are added.
  $('.match-info').each((_i, el) => {
    const m = parseMatchInfo($, el, game);
    if (!m || (m.teamA === 'TBD' && m.teamB === 'TBD')) return;
    const key = pairOf(m);
    const existing = pairIndex.get(key);
    if (existing) {
      if (m.status === 'running' && existing.status !== 'running') {
        existing.status = 'running';
        existing.winner = null;
        if (m.scoreA != null) existing.scoreA = m.scoreA;
        if (m.scoreB != null) existing.scoreB = m.scoreB;
        if (!existing.scheduledAt && m.scheduledAt) existing.scheduledAt = m.scheduledAt;
      }
      return;
    }
    if (seenIds.has(m.externalId)) return;
    seenIds.add(m.externalId);
    pairIndex.set(key, m);
    out.push(m);
  });

  return out;
}

// ---------------------------------------------------------------------------
// EWC Club Championship (season-long club points race + prize pool)
// ---------------------------------------------------------------------------

// Fetch the Club Championship page (wiki is usually "esports").
export async function fetchClubChampionship(wiki, page) {
  const data = await parsePage(wiki, page);
  const html = data?.parse?.text?.['*'];
  if (!html) return { standings: [], prizepool: [] };
  const $ = cheerio.load(html);
  return { standings: parseClubStandings($), prizepool: parseClubPrizepool($) };
}

// ---------------------------------------------------------------------------
// EWC 2026 club / roster catalog
// ---------------------------------------------------------------------------

const EWC_CLUBS_PAGE = 'Esports_World_Cup/2026/Clubs';
const EWC_PLAYER_LIST_PAGE = 'Esports_World_Cup/2026/Player_List';
const EWC_MAIN_PAGE = 'Esports_World_Cup/2026';

export async function fetchEwcClubs() {
  const data = await parsePage('esports', EWC_CLUBS_PAGE);
  const html = data?.parse?.text?.['*'];
  if (!html) return { sourceUrl: 'https://liquipedia.net/esports/Esports_World_Cup/2026/Clubs', games: [], clubs: [] };
  const parsed = parseEwcClubs(cheerio.load(html));
  return {
    sourceUrl: 'https://liquipedia.net/esports/Esports_World_Cup/2026/Clubs',
    ...parsed,
  };
}

export async function fetchEwcPlayerList() {
  const data = await parsePage('esports', EWC_PLAYER_LIST_PAGE);
  const html = data?.parse?.text?.['*'];
  if (!html) return { sourceUrl: 'https://liquipedia.net/esports/Esports_World_Cup/2026/Player_List', players: [] };
  return {
    sourceUrl: 'https://liquipedia.net/esports/Esports_World_Cup/2026/Player_List',
    players: parseEwcPlayerList(cheerio.load(html)),
  };
}

export async function fetchEwcEventSchedule(year = 2026) {
  const page = year === 2026 ? EWC_MAIN_PAGE : `Esports_World_Cup/${year}`;
  const data = await parsePage('esports', page);
  const html = data?.parse?.text?.['*'];
  if (!html) return { year, sourceUrl: `https://liquipedia.net/esports/${page}`, events: [] };
  return {
    year,
    sourceUrl: `https://liquipedia.net/esports/${page}`,
    events: parseEwcEventSchedule(cheerio.load(html)),
  };
}

export async function fetchEwcClubStandings(year = 2026) {
  const page = `Esports_World_Cup/${year}/Club_Championship_Standings`;
  try {
    const data = await parsePage('esports', page);
    const html = data?.parse?.text?.['*'];
    if (!html) return { year, exists: false, standings: [], prizepool: [] };
    const $ = cheerio.load(html);
    return {
      year,
      exists: true,
      sourceUrl: `https://liquipedia.net/esports/${page}`,
      standings: parseClubStandings($),
      prizepool: parseClubPrizepool($),
    };
  } catch (error) {
    if (/doesn'?t exist/i.test(error.message)) return { year, exists: false, standings: [], prizepool: [] };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Counter-Strike Valve Regional Standings
// ---------------------------------------------------------------------------

export { valveRankingRegions };

export async function fetchValveRegionalStandings(region = 'global') {
  const key = normalizeValveRankingRegion(region);
  const data = await parsePage('counterstrike', 'Valve_Regional_Standings');
  const html = data?.parse?.text?.['*'];
  if (!html) return { region: key, label: VRS_REGIONS[key].label, date: null, standings: [] };

  const $ = cheerio.load(html);
  const tables = $('table.table2__table').toArray();
  const table = tables[VRS_REGIONS[key].tableIndex];
  const date =
    $('.navbox .selflink').first().text().match(/\d{4}-\d{2}-\d{2}/)?.[0] ||
    $.text().match(/\d{4}-\d{2}-\d{2}/)?.[0] ||
    null;

  return {
    region: key,
    label: VRS_REGIONS[key].label,
    date,
    sourceUrl: 'https://liquipedia.net/counterstrike/Valve_Regional_Standings',
    standings: table ? parseValveRankingTable($, table, key) : [],
  };
}
