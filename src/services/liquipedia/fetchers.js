// Orchestrator functions that combine the HTTP client with the HTML parsers
// to produce structured data. These are the outward-facing "fetch" entrypoints.

import * as cheerio from 'cheerio';
import { logger } from '../../lib/logger.js';
import { formatLiquipediaPageTitle } from '../../lib/parseTournamentInput.js';
import { normalizeTeamName } from '../../lib/render.js';
import * as lpdb from '../lpdb.js';
import { parsePage } from './client.js';
import {
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
  normalizeValveRankingRegion,
  parseValveRankingTable,
} from './parsers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanDisplayTitle(title) {
  if (!title) return null;
  const text = /</.test(title) ? cheerio.load(`<main>${title}</main>`)('main').text() : title;
  return text.replace(/\s+/g, ' ').trim() || null;
}

// ---------------------------------------------------------------------------
// Tournament title resolver
// ---------------------------------------------------------------------------

export async function resolveTournamentTitle(tournament) {
  const [game, ...rest] = tournament.external_id.split('/');
  const page = rest.join('/');
  if (!page) return null;

  const data = await parsePage(game, page);
  const title = cleanDisplayTitle(data?.parse?.displaytitle) || cleanDisplayTitle(data?.parse?.title);
  return title && !title.includes('/') ? title : formatLiquipediaPageTitle(page);
}

// ---------------------------------------------------------------------------
// Match fetchers
// ---------------------------------------------------------------------------

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
