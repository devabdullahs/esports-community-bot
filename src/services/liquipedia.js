import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { formatLiquipediaPageTitle } from '../lib/parseTournamentInput.js';
import { normalizeTeamName } from '../lib/render.js';
import * as lpdb from './lpdb.js';
import { rateState, loadRateState, saveRateState } from './liquipedia/rateState.js';

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
const nowSec = () => Math.floor(Date.now() / 1000);
const apiUrl = (game) => `https://liquipedia.net/${game}/api.php`;
const normPath = (s) => decodeURIComponent(String(s ?? '')).toLowerCase();
// Liquipedia appends "(page does not exist)" to names whose wiki page is missing (common for
// individual players in chess / EA FC). Strip it so names render cleanly.
const cleanName = (s) =>
  String(s ?? '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\(page does not exist\)/gi, '')
    .replace(/\((?:[^)]*?\s)?stack\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
const isPlaceholderTeam = (s) => {
  const name = cleanName(s);
  return !name || /^TBD$/i.test(name);
};

function normalizeImageUrl(src) {
  if (!src || src.startsWith('data:')) return null;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `https://liquipedia.net${src}`;
  if (/^https?:\/\//i.test(src)) return src;
  return null;
}

function normalizePageUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://liquipedia.net${href}`;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

function imageSrc($img) {
  const srcset = $img.attr('srcset')?.split(',')[0]?.trim()?.split(/\s+/)[0];
  return $img.attr('data-src') || $img.attr('src') || srcset || null;
}

function teamLogo($, el) {
  const selectors = ['.team-template-image img', '.team-template-logo img', '.brkts-opponent-icon img', 'img'];
  let fallback = null;
  for (const selector of selectors) {
    const imgs = $(el).find(selector).toArray();
    for (const img of imgs) {
      const url = normalizeImageUrl(imageSrc($(img)));
      if (!url) continue;
      if (!fallback) fallback = url;
      if (!/\/flags\/|flag_/i.test(url)) return url;
    }
  }
  return fallback;
}

// A match that started in the recent past with no recorded result yet is treated as live for
// this long. (Liquipedia serves true live status/scores client-side, so they are NOT present in
// the static action=parse HTML — this is the best "currently being played" signal we have.)
const LIVE_WINDOW_S = 4 * 3600;

// Shared status logic for brackets, match lists, and the upcoming-matches widget.
function deriveStatus({ winA = false, winB = false, scoreA, scoreB, bestOf, scheduledAt, placeholder = false }) {
  const winAt = bestOf ? Math.floor(bestOf / 2) + 1 : null;
  const reachedWin = winAt != null && ((scoreA ?? 0) >= winAt || (scoreB ?? 0) >= winAt);
  if (winA || winB || reachedWin) return 'finished';
  if ((scoreA ?? 0) + (scoreB ?? 0) > 0) return 'running'; // has a partial score → in progress
  if (placeholder) return 'scheduled';
  const now = nowSec();
  if (scheduledAt && now >= scheduledAt && now - scheduledAt <= LIVE_WINDOW_S) return 'running';
  return 'scheduled';
}

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

// Parse a single .match-info element into a normalized match. Works for both the Main_Page
// ticker (horizontal: .match-info-header-opponent) and the tournament page (vertical:
// .match-info-opponent-row) — both wrap each team in a .block-team.
export function parseMatchInfo($, el, game) {
  const $m = $(el);

  const readTeam = (block) => {
    const $b = $(block);
    return (
      cleanName(
        $b.find('a[title]').first().attr('title') ||
          $b.find('[data-highlightingclass]').attr('data-highlightingclass') ||
          $b.find('.name').first().text(),
      ) || 'TBD'
    );
  };
  // Team games wrap each side in .block-team; 1v1-player wikis (chess, EA FC, fighting games)
  // use .block-player instead. Prefer exactly two .block-team; otherwise take the first
  // opponent block from each of the two header sides. Require exactly two sides/players so that
  // 8-player lobby cards (TFT, battle-royale placement) don't get mistaken for a 1v1 match.
  let blocks = $m.find('.block-team').toArray();
  if (blocks.length !== 2) {
    const sides = $m.find('.match-info-header-opponent').toArray();
    const perSide = sides.map((s) => $(s).find('.block-team, .block-player').first().get(0)).filter(Boolean);
    if (perSide.length === 2) blocks = perSide;
    else {
      const players = $m.find('.block-player').toArray();
      blocks = players.length === 2 ? players : [];
    }
  }
  const teamA = blocks[0] ? readTeam(blocks[0]) : 'TBD';
  const teamB = blocks[1] ? readTeam(blocks[1]) : 'TBD';
  const logoA = blocks[0] ? teamLogo($, blocks[0]) : null;
  const logoB = blocks[1] ? teamLogo($, blocks[1]) : null;

  const scheduledAt = Number($m.find('.timer-object[data-timestamp]').attr('data-timestamp')) || null;
  const tHref = $m.find('.match-info-tournament a[href]').first().attr('href') || '';
  const tournamentPath = tHref.replace(/^\//, '').split('#')[0];
  const tournamentName =
    cleanName($m.find('.match-info-tournament-name').first().text()) ||
    cleanName($m.find('.match-info-tournament a').last().text()) ||
    null;
  const tournamentDetail = cleanName(
    $m
      .find('.match-info-tournament-wrapper')
      .first()
      .children()
      .filter((_i, child) => !$(child).hasClass('match-info-tournament-name'))
      .map((_i, child) => $(child).text())
      .get()
      .join(' '),
  );

  if (!blocks.length && tournamentName) {
    const status = deriveStatus({ scheduledAt });
    const name = tournamentDetail ? `${tournamentName} — ${tournamentDetail}` : tournamentName;
    return {
      source: 'liquipedia',
      externalId: `${game}:event:${scheduledAt}:${name}`,
      name,
      teamA: tournamentName,
      teamB: tournamentDetail || 'Lobby',
      logoA: teamLogo($, $m.find('.match-info-tournament').first()),
      logoB: null,
      scoreA: null,
      scoreB: null,
      bestOf: null,
      scheduledAt,
      status,
      tournamentPath,
      tournamentName,
    };
  }

  // Scores: vertical layout has per-opponent .match-info-opponent-score; the horizontal
  // ticker has a single .match-info-header-scoreholder-upper ("vs" | ":" | "2 : 1").
  let scoreA = null;
  let scoreB = null;
  const oppScores = $m.find('.match-info-opponent-score');
  if (oppScores.length >= 2) {
    const a = $(oppScores[0]).text().replace(/[^0-9]/g, '');
    const b = $(oppScores[1]).text().replace(/[^0-9]/g, '');
    scoreA = a === '' ? null : Number(a);
    scoreB = b === '' ? null : Number(b);
  } else {
    const nums = $m.find('.match-info-header-scoreholder-upper').text().trim().match(/\d+/g);
    if (nums) {
      scoreA = Number(nums[0]);
      scoreB = nums[1] != null ? Number(nums[1]) : null;
    }
  }
  const bestOf = Number($m.find('.match-info-header-scoreholder-lower').text().match(/Bo(\d+)/i)?.[1]) || null;

  // Unique, stable match id from the "View match details" link (falls back to a composite).
  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const matchId = matchHref.split('/').pop() || null;
  const externalId = matchId || `${game}:${scheduledAt}:${teamA}:${teamB}`;

  const status = deriveStatus({ scoreA, scoreB, bestOf, scheduledAt });

  return {
    source: 'liquipedia',
    externalId,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    logoA,
    logoB,
    scoreA,
    scoreB,
    bestOf,
    scheduledAt,
    status,
    tournamentPath,
    tournamentName,
  };
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

// Parse one bracket/matchlist match (.brkts-match) — the AUTHORITATIVE match list on a
// tournament page: a stable set (unlike the rotating "Upcoming" widget) carrying winners,
// final scores, and best-of. Returns null for an undetermined (TBD vs TBD) slot.
export function parseBracketMatch($, el, game, scope = '') {
  const $m = $(el);
  const entries = $m.find('.brkts-opponent-entry');
  if (entries.length < 2) return null;

  // Full team name is in the entry's aria-label; .name is the short fallback.
  const readTeam = (e) =>
    cleanName(
      $(e).attr('aria-label') ||
        $(e).find('[data-highlightingclass]').attr('data-highlightingclass') ||
        $(e).find('.name').first().text() ||
        $(e).find('.brkts-opponent-block-literal').first().text(),
    ) || 'TBD';
  const teamA = readTeam(entries[0]);
  const teamB = readTeam(entries[1]);
  if (isPlaceholderTeam(teamA) && isPlaceholderTeam(teamB)) return null;
  const logoA = teamLogo($, entries[0]);
  const logoB = teamLogo($, entries[1]);

  const scoreEls = $m.find('.brkts-opponent-score-inner');
  const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
  const scoreA = scoreEls[0] ? num($(scoreEls[0]).text().trim()) : null;
  const scoreB = scoreEls[1] ? num($(scoreEls[1]).text().trim()) : null;

  // The winning side's entry contains a .brkts-opponent-win marker — a reliable "finished" signal.
  const winA = $(entries[0]).find('.brkts-opponent-win').length > 0;
  const winB = $(entries[1]).find('.brkts-opponent-win').length > 0;

  const scheduledAt = Number($m.find('[data-timestamp]').attr('data-timestamp')) || null;
  const bestOf = Number($m.find('.brkts-popup').text().match(/\(Bo(\d+)\)/i)?.[1]) || null;

  const status = deriveStatus({
    winA,
    winB,
    scoreA,
    scoreB,
    bestOf,
    scheduledAt,
    placeholder: isPlaceholderTeam(teamA) || isPlaceholderTeam(teamB),
  });

  // Prefer Liquipedia's stable Match: id; fall back to a composite that stays constant per match.
  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const fallbackScope = scheduledAt ?? (scope || 'unknown');
  const externalId = matchHref.split('/').pop() || `${game}:${fallbackScope}:${teamA}:${teamB}`;

  return {
    source: 'liquipedia',
    externalId,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    logoA,
    logoB,
    scoreA,
    scoreB,
    bestOf,
    scheduledAt,
    status,
    winner: winA ? teamA : winB ? teamB : null,
  };
}

// Parse one match-list row (.brkts-matchlist-match) — used by group stages, Swiss rounds, and
// weekly schedules (e.g. CDL). Same shape as a bracket match but with different cell classes.
export function parseMatchlistMatch($, el, game, scope = '') {
  const $m = $(el);
  const opps = $m.find('.brkts-matchlist-opponent');
  if (opps.length < 2) return null;

  const readTeam = (e) =>
    cleanName(
      $(e).attr('aria-label') ||
        $(e).find('[data-highlightingclass]').attr('data-highlightingclass') ||
        $(e).find('.name').first().text() ||
        $(e).find('.brkts-opponent-block-literal').first().text(),
    ) || 'TBD';
  const teamA = readTeam(opps[0]);
  const teamB = readTeam(opps[1]);
  if (isPlaceholderTeam(teamA) && isPlaceholderTeam(teamB)) return null;
  const logoA = teamLogo($, opps[0]);
  const logoB = teamLogo($, opps[1]);

  const scoreEls = $m.find('.brkts-matchlist-score .brkts-matchlist-cell-content');
  const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
  const scoreA = scoreEls[0] ? num($(scoreEls[0]).text().trim()) : null;
  const scoreB = scoreEls[1] ? num($(scoreEls[1]).text().trim()) : null;

  // The winner's opponent cell carries .brkts-matchlist-slot-winner.
  const winA = $(opps[0]).hasClass('brkts-matchlist-slot-winner');
  const winB = $(opps[1]).hasClass('brkts-matchlist-slot-winner');

  const scheduledAt = Number($m.find('[data-timestamp]').attr('data-timestamp')) || null;
  const bestOf = Number($m.find('.brkts-popup').text().match(/\(Bo(\d+)\)/i)?.[1]) || null;
  const status = deriveStatus({
    winA,
    winB,
    scoreA,
    scoreB,
    bestOf,
    scheduledAt,
    placeholder: isPlaceholderTeam(teamA) || isPlaceholderTeam(teamB),
  });

  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const fallbackScope = scheduledAt ?? (scope || 'unknown');
  const externalId = matchHref.split('/').pop() || `${game}:${fallbackScope}:${teamA}:${teamB}`;

  return {
    source: 'liquipedia',
    externalId,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    logoA,
    logoB,
    scoreA,
    scoreB,
    bestOf,
    scheduledAt,
    status,
    winner: winA ? teamA : winB ? teamB : null,
  };
}

// Parse Swiss-stage standings grids (table.swisstable): "# | Team | Matches | BU | Round 1..N",
// where each round cell holds the opponent + a score + a win/loss class. Each match shows up in
// both teams' rows, so we dedupe by team-pair. Used by RLCS and other Swiss-format events whose
// matches are not in brackets or match lists.
export function parseSwissMatches($, game) {
  const out = [];
  const seen = new Set();
  $('.swisstable').each((_t, table) => {
    $(table)
      .find('tr')
      .slice(1)
      .each((_r, row) => {
        // The row's own team = first non-round cell that holds a team.
        let rowTeam = '';
        let rowLogo = null;
        $(row)
          .children('td')
          .each((_c, cell) => {
            if (rowTeam || (($(cell).attr('class') || '').includes('swisstable-bgc'))) return;
            const t = teamName($, cell);
            if (t && t !== 'TBD') {
              rowTeam = t;
              rowLogo = teamLogo($, cell);
            }
          });
        if (!rowTeam) return;

        // Round cells carry a swisstable-bgc-* class (win / loss / empty).
        $(row)
          .find('td[class*="swisstable-bgc"]')
          .each((_c, cell) => {
            const $cell = $(cell);
            const sc = $cell.text().match(/(\d+)\s*[:\-]\s*(\d+)/);
            if (!sc) return; // not played yet
            const scoreA = Number(sc[1]);
            const scoreB = Number(sc[2]);
            if (scoreA === 0 && scoreB === 0) return; // empty / placeholder cell
            const opp = teamName($, cell);
            if (!opp || opp === 'TBD' || opp.toLowerCase() === rowTeam.toLowerCase()) return;
            const oppLogo = teamLogo($, cell);
            const pairKey = [rowTeam.toLowerCase(), opp.toLowerCase()].sort().join('|');
            if (seen.has(pairKey)) return; // mirror row → same match
            seen.add(pairKey);
            // The standings grid only records COMPLETED matches, so a decided score is finished
            // (the loser's cell lacks the win/loss class, so we derive the winner from the score).
            const decided = scoreA !== scoreB;
            out.push({
              source: 'liquipedia',
              externalId: `${game}:swiss:${pairKey}`,
              name: `${rowTeam} vs ${opp}`,
              teamA: rowTeam,
              teamB: opp,
              logoA: rowLogo,
              logoB: oppLogo,
              scoreA,
              scoreB,
              bestOf: null,
              scheduledAt: null,
              status: decided ? 'finished' : 'running',
              winner: decided ? (scoreA > scoreB ? rowTeam : opp) : null,
            });
          });
      });
  });
  return out;
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

// Resolve a team's full name from a Liquipedia team-template cell.
function teamName($, cell) {
  const $c = $(cell);
  const raw =
    $c.find('[data-highlightingclass]').attr('data-highlightingclass') ||
    $c.find('a[title]').last().attr('title') ||
    $c.find('a').last().text() ||
    $c.text();
  return raw.replace(/\(page does not exist\)/i, '').replace(/\s+/g, ' ').trim();
}

// Parse the "Points Standings" wikitable: # | trend | Team | Points.
export function parseClubStandings($) {
  let table = null;
  $('table.wikitable').each((_i, el) => {
    if (table) return;
    const headers = $(el)
      .find('tr')
      .first()
      .find('th,td')
      .map((_j, c) => $(c).text().replace(/\s+/g, ' ').trim())
      .get();
    const hasTeam = headers.some((h) => /team|participant|club/i.test(h));
    const hasPoints = headers.some((h) => /points/i.test(h));
    if (hasTeam && hasPoints && $(el).find('tr').length > 5) table = el;
  });
  if (!table) return [];

  const $table = $(table);
  const headers = $table.find('tr').first().find('th,td').map((_j, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
  const idxTeam = headers.findIndex((h) => /team|participant|club/i.test(h));
  let idxPoints = headers.findIndex((h) => /total\s*points/i.test(h));
  if (idxPoints < 0) idxPoints = headers.findIndex((h) => /points/i.test(h));
  if (idxTeam < 0 || idxPoints < 0) return [];

  // The standings table stacks weekly snapshots; each row is tagged with a week group via
  // data-toggle-area-content="N". The highest N is the latest week = current standings.
  const bodyRows = $table.find('tr').slice(1).toArray();
  const areaOf = (r) => {
    const v = Number($(r).attr('data-toggle-area-content'));
    return Number.isNaN(v) ? null : v;
  };
  const areas = bodyRows.map(areaOf).filter((v) => v !== null);
  const latest = areas.length ? Math.max(...areas) : null;
  const rows = latest === null ? bodyRows : bodyRows.filter((r) => areaOf(r) === latest);

  const out = [];
  for (const row of rows) {
    const cells = $(row).find('td,th');
    if (cells.length <= Math.max(idxTeam, idxPoints)) continue;
    const team = teamName($, cells[idxTeam]);
    const points = Number($(cells[idxPoints]).text().replace(/[^0-9]/g, ''));
    if (!team || Number.isNaN(points)) continue;
    const rank = Number($(cells[0]).text().replace(/[^0-9]/g, '')) || out.length + 1;
    out.push({ rank, team, points, eligibility: detectEligibility($, cells[idxTeam], row) });
  }
  return out;
}

// Liquipedia marks Club Championship eligibility with colored backgrounds during a LIVE event:
//   green  = ≥2 Top-8 finishes            → eligible for the prize pool
//   yellow = ≥2 Top-8 finishes + ≥1 win   → eligible to win the Championship
// Finished/empty pages don't carry these markers, so this returns null until a live event
// populates them (then the exact class/color can be confirmed and mapped here).
function detectEligibility($, teamCell, row) {
  const blob = `${$(teamCell).attr('class') || ''} ${$(teamCell).attr('style') || ''} ${$(row).attr('class') || ''} ${$(row).attr('style') || ''}`.toLowerCase();
  if (/yellow|gold/.test(blob)) return 'champion';
  if (/green/.test(blob)) return 'prize';
  return null;
}

// Parse the prize-pool csstable-widget: Place | $ USD | (Qualifies To) | Participant.
export function parseClubPrizepool($) {
  const table = $('.prizepooltable').first();
  if (!table.length) return [];
  const out = [];
  table.find('.csstable-widget-row').each((_i, row) => {
    const $row = $(row);
    if ($row.hasClass('prizepooltable-header')) return;
    const place = $row.find('.prizepooltable-place').first().text().replace(/\s+/g, ' ').trim();
    if (!place) return;
    const cells = $row.find('.csstable-widget-cell');
    let prize = null;
    cells.each((_j, c) => {
      const t = $(c).text().trim();
      if (!prize && t.includes('$')) prize = t.replace(/\s+/g, ' ').trim();
    });
    // Tied placements list each team in its own cell — collect every team cell, not just one.
    const teams = [];
    cells.each((_j, c) => {
      if ($(c).find('.block-team').length === 0) return;
      const name = teamName($, c);
      if (name && name !== 'TBD' && !teams.includes(name)) teams.push(name);
    });
    out.push({ place, prize, teams, team: teams[0] || 'TBD' });
  });
  return out;
}

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

const EWC_GAME_LABELS = {
  Apex: 'Apex Legends',
  CF: 'CrossFire',
  Chess: 'Chess',
  'Call of Duty: Black Ops 7': 'Call of Duty: Black Ops 7',
  WZ: 'Call of Duty: Warzone',
  CS2: 'Counter-Strike 2',
  Dota2: 'Dota 2',
  'EA SPORTS FC 26': 'EA SPORTS FC 26',
  'Free Fire': 'Free Fire',
  'Fatal Fury': 'Fatal Fury: City of the Wolves',
  FN: 'Fortnite',
  HoK: 'Honor of Kings',
  LoL: 'League of Legends',
  'Mobile Legends: Bang Bang': 'Mobile Legends: Bang Bang',
  "MLBB Women's Invitational": "MLBB Women's Invitational",
  OW2: 'Overwatch 2',
  PUBG: 'PUBG',
  'PUBG Mobile': 'PUBG Mobile',
  'Rainbow Six Siege X': 'Rainbow Six Siege X',
  RL: 'Rocket League',
  SF6: 'Street Fighter 6',
  T8: 'Tekken 8',
  TFT: 'Teamfight Tactics',
  Trackmania: 'Trackmania',
  VAL: 'VALORANT',
};

function normalizeEwcGameLabel(label) {
  const text = cleanName(label);
  return EWC_GAME_LABELS[text] || text;
}

function slugFromLiquipediaTitle(title) {
  const match = String(title || '').match(/^([^:]+):(.+)$/);
  return match ? match[1].toLowerCase() : null;
}

function pageNameFromLiquipediaTitle(title) {
  const match = String(title || '').match(/^[^:]+:(.+)$/);
  return cleanName(match ? match[1] : title);
}

function statusFromIconClass(iconClass) {
  if (/fa-check-circle/.test(iconClass)) return 'qualified';
  if (/fa-question/.test(iconClass)) return 'can_qualify';
  if (/fa-times/.test(iconClass)) return 'eliminated';
  if (/fa-ban/.test(iconClass)) return 'ineligible';
  return 'has_team';
}

function summarizeEwcStatuses(entries) {
  const statuses = entries.map((entry) => entry.status);
  const counts = statuses.reduce((acc, status) => {
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  let status = null;
  if (statuses.includes('qualified')) status = 'qualified';
  else if (statuses.includes('can_qualify')) status = 'can_qualify';
  else if (statuses.includes('eliminated')) status = 'eliminated';
  else if (statuses.includes('ineligible')) status = 'ineligible';
  else if (statuses.includes('has_team')) status = 'has_team';
  return { status, counts };
}

function parseEwcRosterEntries($, cell) {
  const entries = [];
  $(cell)
    .find('a[href]')
    .each((_i, link) => {
      const $link = $(link);
      const title = $link.attr('title') || '';
      const href = normalizePageUrl($link.attr('href'));
      const iconClass = $link.find('i').first().attr('class') || '';
      const wiki = slugFromLiquipediaTitle(title) || href?.match(/^https:\/\/liquipedia\.net\/([^/]+)/i)?.[1]?.toLowerCase() || null;
      const name = pageNameFromLiquipediaTitle(title);
      if (!wiki || !name) return;
      entries.push({ wiki, name, url: href, status: statusFromIconClass(iconClass) });
    });
  return entries;
}

function ewcClubHeader($, cell) {
  const $cell = $(cell);
  const raw =
    $cell.find('a[title]').first().attr('title') ||
    $cell.find('img').first().attr('alt') ||
    $cell.text();
  const label = normalizeEwcGameLabel(raw);
  return {
    label,
    shortLabel: cleanName(raw),
    pageUrl: normalizePageUrl($cell.find('a[href]').first().attr('href')),
    icon: normalizeImageUrl(imageSrc($cell.find('img').first())),
  };
}

function parseQualifiedCount(text) {
  const [qualified, total] = cleanName(text)
    .split('/')
    .map((part) => Number(part.replace(/[^0-9]/g, '')));
  return {
    qualified: Number.isFinite(qualified) ? qualified : 0,
    possible: Number.isFinite(total) ? total : null,
  };
}

export function parseEwcClubs($) {
  const table = $('table.wikitable.sortable')
    .toArray()
    .find((el) => {
      const headers = $(el)
        .find('tr')
        .first()
        .children('th,td')
        .map((_i, c) => $(c).text().replace(/\s+/g, ' ').trim())
        .get();
      return headers.includes('Team Name') && headers.includes('Q#') && headers.includes('T#');
    });
  if (!table) return { games: [], clubs: [] };

  const headerCells = $(table).find('tr').first().children('th,td').toArray();
  const games = headerCells.slice(4).map((cell) => ewcClubHeader($, cell));
  const clubs = [];

  for (const row of $(table).find('tr').slice(1).toArray()) {
    const cells = $(row).children('th,td').toArray();
    if (cells.length < 4) continue;

    const name = teamName($, cells[0]);
    if (!name || /^team name$/i.test(name)) continue;
    const qualifiedCount = parseQualifiedCount($(cells[2]).text());
    const totalTeams = Number(cleanName($(cells[3]).text()).replace(/[^0-9]/g, '')) || 0;
    const gameEntries = [];

    for (let i = 0; i < games.length; i += 1) {
      const cell = cells[i + 4];
      if (!cell) continue;
      const entries = parseEwcRosterEntries($, cell);
      if (!entries.length) continue;
      const { status, counts } = summarizeEwcStatuses(entries);
      gameEntries.push({
        ...games[i],
        status,
        statusCounts: counts,
        entries,
      });
    }

    clubs.push({
      name,
      pageUrl: normalizePageUrl($(cells[0]).find('a[href]').first().attr('href')),
      logo: teamLogo($, cells[0]),
      clubSupportProgram: /Esports_World_Cup|EWC/i.test($(cells[1]).find('a[title]').first().attr('title') || ''),
      qualifiedCount: qualifiedCount.qualified,
      possibleEvents: qualifiedCount.possible,
      totalTeams,
      games: gameEntries,
    });
  }

  return { games, clubs };
}

function findEwcPlayerTable($) {
  return $('table.table2__table')
    .toArray()
    .find((table) => {
      const text = $(table).text().replace(/\s+/g, ' ');
      return /List of Players attending the 2026 EWC/i.test(text) && /\bPlayer\b/.test(text) && /\bTeam\b/.test(text);
    });
}

function parseBirthCell(text) {
  const clean = cleanName(text);
  const date = clean.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
  const age = Number(clean.match(/\((\d+)\)/)?.[1]) || null;
  return { birthDate: date, age };
}

export function parseEwcPlayerList($) {
  const table = findEwcPlayerTable($);
  if (!table) return [];

  const rows = $(table).find('tr').toArray();
  const headerIndex = rows.findIndex((row) => {
    const cells = $(row).children('th,td').map((_i, c) => cleanName($(c).text())).get();
    return cells.includes('Player') && cells.includes('Team') && cells.includes('Game');
  });
  if (headerIndex < 0) return [];

  const players = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const cells = $(row).children('th,td').toArray();
    if (cells.length < 7) continue;
    const id = cleanName($(cells[1]).text());
    if (!id || /^player$/i.test(id)) continue;
    const { birthDate, age } = parseBirthCell($(cells[4]).text());
    const gameTitle = $(cells[6]).find('a[title]').first().attr('title') || '';
    const gameWiki = slugFromLiquipediaTitle(gameTitle);
    players.push({
      country: cleanName($(cells[0]).find('a[title]').first().attr('title') || $(cells[0]).text()),
      id,
      givenName: cleanName($(cells[2]).text()) || null,
      familyName: cleanName($(cells[3]).text()) || null,
      birthDate,
      age,
      team: teamName($, cells[5]),
      teamUrl: normalizePageUrl($(cells[5]).find('a[href]').first().attr('href')),
      teamLogo: teamLogo($, cells[5]),
      game: normalizeEwcGameLabel($(cells[6]).text()),
      gameWiki,
      gameUrl: normalizePageUrl($(cells[6]).find('a[href]').first().attr('href')),
    });
  }
  return players;
}

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

const MONTHS = new Map([
  ['jan', 0],
  ['january', 0],
  ['feb', 1],
  ['february', 1],
  ['mar', 2],
  ['march', 2],
  ['apr', 3],
  ['april', 3],
  ['may', 4],
  ['jun', 5],
  ['june', 5],
  ['jul', 6],
  ['july', 6],
  ['aug', 7],
  ['august', 7],
  ['sep', 8],
  ['sept', 8],
  ['september', 8],
  ['oct', 9],
  ['october', 9],
  ['nov', 10],
  ['november', 10],
  ['dec', 11],
  ['december', 11],
]);

function riyadhStartOfDay(year, month, day) {
  return Math.floor(Date.UTC(year, month, day, -3, 0, 0) / 1000);
}

function parseEwcDateRange(raw) {
  const text = cleanName(raw).replace(/^\d{4}\s+/, '');
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2}),\s*(\d{4})$/);
  if (!match) return { label: text, startAt: null, endAt: null };
  const startMonth = MONTHS.get(match[1].toLowerCase());
  const startDay = Number(match[2]);
  const endMonth = MONTHS.get((match[3] || match[1]).toLowerCase());
  const endDay = Number(match[4]);
  const year = Number(match[5]);
  if (!Number.isFinite(startMonth) || !Number.isFinite(endMonth)) return { label: text, startAt: null, endAt: null };
  const startAt = riyadhStartOfDay(year, startMonth, startDay);
  const endAt = riyadhStartOfDay(year, endMonth, endDay + 1) - 1;
  return { label: text, startAt, endAt };
}

function findEwcTournamentsTable($) {
  return $('table.table2__table')
    .toArray()
    .find((table) => /List of Tournaments/i.test($(table).text()) && /Prize Pool/i.test($(table).text()));
}

export function parseEwcEventSchedule($) {
  const table = findEwcTournamentsTable($);
  if (!table) return [];
  const rows = $(table).find('tr').toArray();
  const headerIndex = rows.findIndex((row) => {
    const cells = $(row).children('th,td').map((_i, c) => cleanName($(c).text())).get();
    return cells.includes('Game') && cells.includes('Date') && cells.includes('Event');
  });
  if (headerIndex < 0) return [];

  const events = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const cells = $(row).children('th,td').toArray();
    if (cells.length < 5) continue;
    const game = normalizeEwcGameLabel($(cells[0]).text());
    const gameTitle = $(cells[0]).find('a[title]').first().attr('title') || '';
    const date = parseEwcDateRange($(cells[1]).text());
    const eventCell = cells[2];
    const eventName = cleanName($(eventCell).text());
    if (!game || !eventName || !date.startAt) continue;
    const eventLink =
      $(eventCell)
        .find('a[href]')
        .toArray()
        .map((a) => normalizePageUrl($(a).attr('href')))
        .find((href) => /liquipedia\.net/i.test(href || '')) || normalizePageUrl($(eventCell).find('a[href]').last().attr('href'));
    events.push({
      game,
      gameWiki: slugFromLiquipediaTitle(gameTitle) || $(cells[0]).find('a[href]').first().attr('href')?.match(/liquipedia\.net\/([^/]+)/i)?.[1] || null,
      dateLabel: date.label,
      startAt: date.startAt,
      endAt: date.endAt,
      event: eventName,
      eventUrl: eventLink,
      prizePool: cleanName($(cells[3]).text()) || null,
      participants: cleanName($(cells[4]).text()) || null,
    });
  }
  return events.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.game.localeCompare(b.game));
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

const VRS_REGIONS = {
  global: { label: 'Global', tableIndex: 0 },
  europe: { label: 'Europe', tableIndex: 1 },
  americas: { label: 'Americas', tableIndex: 2 },
  asia: { label: 'Asia', tableIndex: 3 },
};

export const valveRankingRegions = Object.keys(VRS_REGIONS);

function normalizeValveRankingRegion(region) {
  const key = String(region || 'global').toLowerCase();
  if (['eu', 'europe'].includes(key)) return 'europe';
  if (['am', 'americas', 'america'].includes(key)) return 'americas';
  if (['as', 'asia'].includes(key)) return 'asia';
  return 'global';
}

function tableCells($, row) {
  return $(row)
    .find('th,td')
    .map((_i, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
    .get();
}

function parseValveRankingTable($, table, region) {
  const out = [];
  const global = region === 'global';
  $(table)
    .find('tr')
    .slice(1)
    .each((_i, row) => {
      const cells = tableCells($, row);
      if (cells.length < 4) return;
      const teamCell = $(row).find('td').eq(global ? 2 : 3);
      const team = cleanName(
        teamCell.find('.team-template-text a').first().text() ||
          teamCell.find('a[title]').last().attr('title') ||
          teamCell.text(),
      );
      if (!team) return;

      const roster = $(row)
        .find('td')
        .last()
        .find('.block-player .name')
        .map((_j, el) => cleanName($(el).text()))
        .get()
        .filter(Boolean);

      out.push({
        rank: Number(cells[0]) || out.length + 1,
        globalRank: global ? Number(cells[0]) || null : Number(cells[1]) || null,
        points: Number(cells[global ? 1 : 2]) || 0,
        team,
        region: global ? cells[3] || null : VRS_REGIONS[region].label,
        roster,
      });
    });
  return out;
}

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
