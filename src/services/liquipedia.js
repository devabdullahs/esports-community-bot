import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// PRIMARY (free) data source. Covers VCT, LCS/Worlds, IEM/CS2, RLCS, OWCS, EWC, etc.
//
// Liquipedia API Terms of Use (https://liquipedia.net/api-terms-of-use) REQUIRE:
//   • a descriptive User-Agent identifying the app + contact (set LIQUIPEDIA_USER_AGENT)
//   • action=parse (what we use — "more resource intensive") ≤ 1 request / 30 SECONDS
//   • re-use / cache results as long as possible
// We use the MediaWiki API (action=parse) — NOT raw scraping — and enforce a 30s GLOBAL gap
// between parse requests, a multi-minute response cache (so many matches/polls share one
// fetch), and automatic backoff if Liquipedia rate-limits us anyway.
const PARSE_MIN_GAP_MS = 30_000; // action=parse limit is 1 request / 30s (NOT the general 1/2s)
const CACHE_TTL_MS = 5 * 60_000; // serve cached pages for 5 min — keeps us well under the limit
const BACKOFF_MS = 20 * 60_000; // pause all requests this long after a rate-limit response

const client = axios.create({
  timeout: 20_000,
  headers: { 'User-Agent': config.liquipedia.userAgent, 'Accept-Encoding': 'gzip' },
});

let lastRequestAt = 0;
let blockedUntil = 0;
const cache = new Map(); // key -> { at, data }
const nowSec = () => Math.floor(Date.now() / 1000);
const apiUrl = (game) => `https://liquipedia.net/${game}/api.php`;
const normPath = (s) => decodeURIComponent(String(s ?? '')).toLowerCase();

// A match that started in the recent past with no recorded result yet is treated as live for
// this long. (Liquipedia serves true live status/scores client-side, so they are NOT present in
// the static action=parse HTML — this is the best "currently being played" signal we have.)
const LIVE_WINDOW_S = 4 * 3600;

// Shared status logic for brackets, match lists, and the upcoming-matches widget.
function deriveStatus({ winA = false, winB = false, scoreA, scoreB, bestOf, scheduledAt }) {
  const winAt = bestOf ? Math.floor(bestOf / 2) + 1 : null;
  const reachedWin = winAt != null && ((scoreA ?? 0) >= winAt || (scoreB ?? 0) >= winAt);
  if (winA || winB || reachedWin) return 'finished';
  if ((scoreA ?? 0) + (scoreB ?? 0) > 0) return 'running'; // has a partial score → in progress
  const now = nowSec();
  if (scheduledAt && now >= scheduledAt && now - scheduledAt <= LIVE_WINDOW_S) return 'running';
  return 'scheduled';
}

async function throttle() {
  const wait = lastRequestAt + PARSE_MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

// Fetch a page's parsed HTML via the MediaWiki API (throttled, cached, with rate-limit backoff).
export async function parsePage(game, page) {
  const key = `${game}/${page}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // If Liquipedia recently rate-limited us, don't touch the network — serve stale or fail fast.
  if (Date.now() < blockedUntil) {
    if (hit) return hit.data;
    throw new Error('Liquipedia: backing off after a rate limit');
  }

  await throttle();
  try {
    const { data } = await client.get(apiUrl(game), {
      params: { action: 'parse', page, prop: 'text', format: 'json', redirects: true },
    });
    if (data.error) throw new Error(`Liquipedia: ${data.error.info}`);
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    const status = err.response?.status;
    const body = typeof err.response?.data === 'string' ? err.response.data : '';
    if (status === 403 || status === 429 || status === 503 || /rate.?limit|cloudflare|temporarily blocked/i.test(body)) {
      blockedUntil = Date.now() + BACKOFF_MS;
      logger.warn(`[liquipedia] rate limited (HTTP ${status ?? '?'}) — pausing requests for ${BACKOFF_MS / 60000} min`);
    }
    if (hit) return hit.data; // prefer stale data over nothing
    throw err;
  }
}

// Parse a single .match-info element into a normalized match. Works for both the Main_Page
// ticker (horizontal: .match-info-header-opponent) and the tournament page (vertical:
// .match-info-opponent-row) — both wrap each team in a .block-team.
export function parseMatchInfo($, el, game) {
  const $m = $(el);

  const readTeam = (block) => {
    const $b = $(block);
    return (
      $b.find('a[title]').first().attr('title')?.trim() ||
      $b.find('[data-highlightingclass]').attr('data-highlightingclass')?.trim() ||
      $b.find('.name').first().text().trim() ||
      'TBD'
    );
  };
  const teamBlocks = $m.find('.block-team');
  const teamA = teamBlocks[0] ? readTeam(teamBlocks[0]) : 'TBD';
  const teamB = teamBlocks[1] ? readTeam(teamBlocks[1]) : 'TBD';

  const scheduledAt = Number($m.find('.timer-object[data-timestamp]').attr('data-timestamp')) || null;

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

  // Tournament path (present only on the Main_Page ticker; absent on a tournament's own page).
  const tHref = $m.find('.match-info-tournament a[href]').first().attr('href') || '';
  const tournamentPath = tHref.replace(/^\//, '').split('#')[0];
  const tournamentName = $m.find('.match-info-tournament a').last().text().trim() || null;

  const status = deriveStatus({ scoreA, scoreB, bestOf, scheduledAt });

  return {
    source: 'liquipedia',
    externalId,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
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
export function parseBracketMatch($, el, game) {
  const $m = $(el);
  const entries = $m.find('.brkts-opponent-entry');
  if (entries.length < 2) return null;

  // Full team name is in the entry's aria-label; .name is the short fallback.
  const readTeam = (e) => ($(e).attr('aria-label') || $(e).find('.name').first().text() || 'TBD').trim();
  const teamA = readTeam(entries[0]);
  const teamB = readTeam(entries[1]);
  if (teamA === 'TBD' && teamB === 'TBD') return null;

  const scoreEls = $m.find('.brkts-opponent-score-inner');
  const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
  const scoreA = scoreEls[0] ? num($(scoreEls[0]).text().trim()) : null;
  const scoreB = scoreEls[1] ? num($(scoreEls[1]).text().trim()) : null;

  // The winning side's entry contains a .brkts-opponent-win marker — a reliable "finished" signal.
  const winA = $(entries[0]).find('.brkts-opponent-win').length > 0;
  const winB = $(entries[1]).find('.brkts-opponent-win').length > 0;

  const scheduledAt = Number($m.find('[data-timestamp]').attr('data-timestamp')) || null;
  const bestOf = Number($m.find('.brkts-popup').text().match(/\(Bo(\d+)\)/i)?.[1]) || null;

  const status = deriveStatus({ winA, winB, scoreA, scoreB, bestOf, scheduledAt });

  // Prefer Liquipedia's stable Match: id; fall back to a composite that stays constant per match.
  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const externalId = matchHref.split('/').pop() || `${game}:${scheduledAt}:${teamA}:${teamB}`;

  return {
    source: 'liquipedia',
    externalId,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
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
export function parseMatchlistMatch($, el, game) {
  const $m = $(el);
  const opps = $m.find('.brkts-matchlist-opponent');
  if (opps.length < 2) return null;

  const readTeam = (e) => ($(e).attr('aria-label') || $(e).find('.name').first().text() || 'TBD').trim();
  const teamA = readTeam(opps[0]);
  const teamB = readTeam(opps[1]);
  if (teamA === 'TBD' && teamB === 'TBD') return null;

  const scoreEls = $m.find('.brkts-matchlist-score .brkts-matchlist-cell-content');
  const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
  const scoreA = scoreEls[0] ? num($(scoreEls[0]).text().trim()) : null;
  const scoreB = scoreEls[1] ? num($(scoreEls[1]).text().trim()) : null;

  // The winner's opponent cell carries .brkts-matchlist-slot-winner.
  const winA = $(opps[0]).hasClass('brkts-matchlist-slot-winner');
  const winB = $(opps[1]).hasClass('brkts-matchlist-slot-winner');

  const scheduledAt = Number($m.find('[data-timestamp]').attr('data-timestamp')) || null;
  const bestOf = Number($m.find('.brkts-popup').text().match(/\(Bo(\d+)\)/i)?.[1]) || null;
  const status = deriveStatus({ winA, winB, scoreA, scoreB, bestOf, scheduledAt });

  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const externalId = matchHref.split('/').pop() || `${game}:${scheduledAt}:${teamA}:${teamB}`;

  return {
    source: 'liquipedia',
    externalId,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
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
        $(row)
          .children('td')
          .each((_c, cell) => {
            if (rowTeam || (($(cell).attr('class') || '').includes('swisstable-bgc'))) return;
            const t = teamName($, cell);
            if (t && t !== 'TBD') rowTeam = t;
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
  const data = await parsePage(game, page);
  const html = data?.parse?.text?.['*'];
  if (!html) return [];
  const $ = cheerio.load(html);

  const out = [];
  const seenIds = new Set();
  const pairs = new Set();
  const pairOf = (m) => [m.teamA.toLowerCase(), m.teamB.toLowerCase()].sort().join('|');
  const addAuthoritative = (el, parser) => {
    const m = parser($, el, game);
    if (!m || seenIds.has(m.externalId)) return;
    seenIds.add(m.externalId);
    pairs.add(pairOf(m));
    out.push(m);
  };

  // 1) Brackets AND match lists (group / Swiss / weekly schedules) = authoritative:
  //    stable set, with winners + final scores.
  $('.brkts-match').each((_i, el) => addAuthoritative(el, parseBracketMatch));
  $('.brkts-matchlist-match').each((_i, el) => addAuthoritative(el, parseMatchlistMatch));

  // 1c) Swiss group standings grids (RLCS etc.) — matches are encoded in the round cells.
  for (const m of parseSwissMatches($, game)) {
    if (seenIds.has(m.externalId) || pairs.has(pairOf(m))) continue;
    seenIds.add(m.externalId);
    pairs.add(pairOf(m));
    out.push(m);
  }

  // 2) "Upcoming Matches" widget — add ONLY matchups whose team-pair isn't already covered.
  //    A match can appear in both with different ids/timestamps, so dedupe by team-pair.
  $('.match-info').each((_i, el) => {
    const m = parseMatchInfo($, el, game);
    if (!m || (m.teamA === 'TBD' && m.teamB === 'TBD')) return;
    if (seenIds.has(m.externalId) || pairs.has(pairOf(m))) return;
    seenIds.add(m.externalId);
    pairs.add(pairOf(m));
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
