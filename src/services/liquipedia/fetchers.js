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
  parseEwcEventPlacements,
  parseEwcEventSchedule,
  parseTournamentEwcAffiliation,
  VRS_REGIONS,
  normalizeValveRankingRegion,
  parseValveRankingTable,
} from './parsers.js';
import { hasStandingsRows, parseBattleRoyaleSchedules, parseEventStandings } from './standingsParsers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanDisplayTitle(title) {
  if (!title) return null;
  const text = /</.test(title) ? cheerio.load(`<main>${title}</main>`)('main').text() : title;
  return text.replace(/\s+/g, ' ').trim() || null;
}

function titleFromPageSegment(page) {
  const segment = String(page ?? '').split('/').filter(Boolean).pop() || '';
  return segment.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
}

const CHILD_STAGE_SEGMENTS = new Set([
  'Group_Stage',
  'Survival',
  'Survivor_Stage',
  'Finals',
  'Playoffs',
  'Last_Chance',
  'Swiss_Stage',
]);

function childStagePages($, game, page) {
  const prefix = `/${game}/${page.replace(/^\/+|\/+$/g, '')}/`;
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, link) => {
    const href = String($(link).attr('href') ?? '').split(/[?#]/)[0];
    if (!href.startsWith(prefix)) return;
    const child = href.slice(`/${game}/`.length).replace(/^\/+|\/+$/g, '');
    const rest = child.slice(page.length + 1);
    if (!rest || rest.includes('/')) return;
    if (!CHILD_STAGE_SEGMENTS.has(rest)) return;
    if (seen.has(child)) return;
    seen.add(child);
    out.push(child);
  });
  return out;
}

async function loadTournamentPage(game, page) {
  const data = await parsePage(game, page);
  const html = data?.parse?.text?.['*'];
  if (!html) return null;
  return {
    data,
    $: cheerio.load(html),
  };
}

function prefixSections(sections, prefix) {
  if (!prefix) return sections;
  return sections.map((section) => ({
    ...section,
    title: section.title ? `${prefix}: ${section.title}` : prefix,
  }));
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

export async function resolveTournamentEwc(tournament) {
  const [game, ...rest] = tournament.external_id.split('/');
  const page = rest.join('/');
  if (!game || !page) return false;
  const loaded = await loadTournamentPage(game, page);
  return loaded ? parseTournamentEwcAffiliation(loaded.$) : false;
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

  const loaded = await loadTournamentPage(game, page);
  if (!loaded) return [];
  const { $ } = loaded;

  const out = [];
  const seenIds = new Set();
  const pairIndex = new Map(); // pairKey -> kept authoritative matches
  const pairOf = (m) => [normalizeTeamName(m.teamA), normalizeTeamName(m.teamB)].sort().join('|');
  const teamKeysOf = (m) => [normalizeTeamName(m.teamA), normalizeTeamName(m.teamB)].filter(Boolean);
  // A page can render the SAME match twice - once in a bracket widget and once in
  // a match-list widget. Only collapse cross-widget twins that share the exact
  // start timestamp; same-pair rematches later that day, or untimed rows where the
  // match identity is ambiguous, must keep their separate structural ids.
  const authByKey = new Map(); // `${pair}|${scheduledAt}` -> [{ match, widget }]
  const timestampOf = (m) => (m.scheduledAt == null ? null : Number(m.scheduledAt) || null);
  const dayOf = (m) => (m.scheduledAt ? Math.floor(m.scheduledAt / 86400) : 'x');
  const authKeyOf = (m) => {
    const ts = timestampOf(m);
    return ts == null ? null : `${pairOf(m)}|${ts}`;
  };
  const addToPairIndex = (m) => {
    const key = pairOf(m);
    const matches = pairIndex.get(key);
    if (matches) matches.push(m);
    else pairIndex.set(key, [m]);
  };
  const findExistingForLiveWidget = (m) => {
    const matches = pairIndex.get(pairOf(m)) || [];
    const ts = timestampOf(m);
    if (!matches.length && ts != null) {
      const keys = new Set(teamKeysOf(m));
      const sameTimeOverlap = out.filter((candidate) => {
        if (timestampOf(candidate) !== ts) return false;
        const candidateKeys = teamKeysOf(candidate);
        return candidateKeys.some((key) => keys.has(key));
      });
      if (sameTimeOverlap.length === 1) return sameTimeOverlap[0];
      return null;
    }
    if (!matches.length) return null;
    if (ts != null) {
      const exact = matches.find((candidate) => timestampOf(candidate) === ts);
      if (exact) return exact;
      const sameDay = matches.filter((candidate) => dayOf(candidate) === dayOf(m));
      if (sameDay.length === 1) return sameDay[0];
      return null;
    }
    return matches.length === 1 ? matches[0] : null;
  };
  const resultRank = (m) => {
    const hasScore = m.scoreA != null && m.scoreB != null;
    if (m.status === 'finished' && hasScore) return 4;
    if (m.status === 'running') return 3;
    if (m.status === 'finished') return 2;
    return hasScore ? 1 : 0;
  };
  const addAuthoritative = ($page, el, parser, structuralScope, widget) => {
    const m = parser($page, el, game, structuralScope || page);
    if (!m || seenIds.has(m.externalId)) return;
    const key = authKeyOf(m);
    const kept = key ? (authByKey.get(key) || []).find((entry) => entry.widget !== widget)?.match : null;
    if (kept) {
      // Same match from the sibling widget: fold in a richer result, drop the dup.
      if (resultRank(m) > resultRank(kept)) {
        kept.status = m.status;
        kept.scoreA = m.scoreA;
        kept.scoreB = m.scoreB;
        kept.winner = m.winner;
      }
      if (!kept.scheduledAt && m.scheduledAt) kept.scheduledAt = m.scheduledAt;
      return;
    }
    seenIds.add(m.externalId);
    if (key) {
      const matches = authByKey.get(key);
      if (matches) matches.push({ match: m, widget });
      else authByKey.set(key, [{ match: m, widget }]);
    }
    addToPairIndex(m);
    out.push(m);
  };

  const addScheduleMatches = (matches) => {
    for (const m of matches) {
      if (!m || seenIds.has(m.externalId)) continue;
      seenIds.add(m.externalId);
      out.push(m);
    }
  };

  const pages = [{ page, $, stageTitle: '' }];

  for (const child of childStagePages($, game, page)) {
    const childLoaded = await loadTournamentPage(game, child);
    if (!childLoaded) continue;
    pages.push({ page: child, $: childLoaded.$, stageTitle: titleFromPageSegment(child) });
  }

  const addAuthoritativePage = ({ page: pagePath, $: $page, stageTitle }) => {
    // Brackets AND match lists (group / Swiss / weekly schedules) = authoritative:
    // stable set, with winners + final scores.
    $page('.brkts-match').each((i, el) =>
      addAuthoritative($page, el, parseBracketMatch, `${pagePath}:bracket:${i}`, 'bracket'),
    );
    $page('.brkts-matchlist-match').each((i, el) =>
      addAuthoritative($page, el, parseMatchlistMatch, `${pagePath}:matchlist:${i}`, 'matchlist'),
    );

    // Swiss group standings grids (RLCS etc.) — matches are encoded in the round cells.
    for (const m of parseSwissMatches($page, game)) {
      if (seenIds.has(m.externalId) || pairIndex.has(pairOf(m))) continue;
      seenIds.add(m.externalId);
      addToPairIndex(m);
      out.push(m);
    }

    addScheduleMatches(parseBattleRoyaleSchedules($page, game, pagePath, stageTitle));
  };

  const addLiveWidgetsPage = ({ $: $page }) => {
    // "Upcoming Matches" widget = the live matchticker, our best LIVE signal. For a pair we
    // already have, don't duplicate it — but if the widget shows it live, UPGRADE the stored
    // entry to running. (A Swiss/bracket cell can show a live Bo3's partial score, e.g. 1-0,
    // which the score heuristic otherwise reads as "finished".) New matchups are added.
    $page('.match-info').each((_i, el) => {
      const m = parseMatchInfo($page, el, game);
      if (!m || (m.teamA === 'TBD' && m.teamB === 'TBD')) return;
      const existing = findExistingForLiveWidget(m);
      if (existing) {
        if (m.status === 'running' && existing.status !== 'running') {
          existing.status = 'running';
          existing.winner = null;
          if (m.scoreA != null) existing.scoreA = m.scoreA;
          if (m.scoreB != null) existing.scoreB = m.scoreB;
          if (!existing.scheduledAt && m.scheduledAt) existing.scheduledAt = m.scheduledAt;
        } else if (
          m.status === 'finished' &&
          existing.status !== 'finished' &&
          existing.scoreA == null &&
          existing.scoreB == null &&
          m.scheduledAt
        ) {
          // Some widgets keep already-played matches in "Upcoming" with no score/winner.
          // If the same pair is far past its start, retire the unresolved bracket row too.
          existing.status = 'finished';
          if (!existing.scheduledAt) existing.scheduledAt = m.scheduledAt;
        }
        return;
      }
      if (seenIds.has(m.externalId)) return;
      seenIds.add(m.externalId);
      addToPairIndex(m);
      out.push(m);
    });
  };

  for (const loadedPage of pages) addAuthoritativePage(loadedPage);
  for (const loadedPage of pages) addLiveWidgetsPage(loadedPage);

  return out;
}

// ---------------------------------------------------------------------------
// EWC Club Championship (season-long club points race + prize pool)
// ---------------------------------------------------------------------------

export function clubChampionshipStandingsPage(page) {
  const clean = String(page || '').trim().replace(/^\/+|\/+$/g, '');
  const match = clean.match(/^(Esports_World_Cup\/\d{4})(?:\/Club_Championship(?:_Standings)?)?$/i);
  return match ? `${match[1]}/Club_Championship_Standings` : clean;
}

// Fetch the Club Championship page (wiki is usually "esports").
export async function fetchClubChampionship(wiki, page) {
  const data = await parsePage(wiki, clubChampionshipStandingsPage(page));
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

// Derive the {wiki, page} for a stored EWC game event from its Liquipedia URL.
function liquipediaEventPage(event) {
  if (!event?.eventUrl) return null;
  try {
    const url = new URL(event.eventUrl);
    if (!/liquipedia\.net$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { wiki: parts[0].toLowerCase(), page: parts.slice(1).join('/') };
  } catch {
    return null;
  }
}

export async function fetchEwcEventPlacements(event, players = []) {
  const page = liquipediaEventPage(event);
  if (!page) return { ...event, placements: [], error: 'Missing Liquipedia event URL' };
  const data = await parsePage(page.wiki, page.page);
  const html = data?.parse?.text?.['*'];
  if (!html) return { ...event, placements: [], error: 'Empty event page' };
  return {
    ...event,
    placements: parseEwcEventPlacements(cheerio.load(html), event, players),
  };
}

// Fetch per-game weekly placements for a set of EWC game events. The player
// list is fetched once and reused as a solo-game scoring fallback. Each event
// is fetched sequentially so it stays inside the single serialized Liquipedia
// request queue (never parallelize — see rate rules).
export async function fetchEwcWeekGameResults(games) {
  const playerData = await fetchEwcPlayerList().catch((error) => {
    logger.warn(`[ewc] player list unavailable for solo-game scoring fallback: ${error.message}`);
    return { players: [] };
  });
  const results = [];
  for (const game of games || []) {
    results.push(await fetchEwcEventPlacements(game, playerData.players || []));
  }
  return results;
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

// ---------------------------------------------------------------------------
// Event standings (battle-royale panel-tables + round-robin group tables)
// ---------------------------------------------------------------------------

// Standings sections for a tournament page. Used for formats that produce no
// head-to-head matches (BR events, TFT groups). external_id = "game/Page/Path".
// Returns { sections, hadRows }: hadRows tells the caller whether the page
// yielded any parseable standings row, so an empty `sections` from an all-TBD
// event (hadRows true) can be told apart from a page whose standings we couldn't
// parse at all (hadRows false — no standings, a partial page, or a DOM change).
export async function fetchEventStandings(tournament) {
  const [game, ...rest] = tournament.external_id.split('/');
  const page = rest.join('/');
  if (!game || !page) return { sections: [], hadRows: false };
  const loaded = await loadTournamentPage(game, page);
  if (!loaded) return { sections: [], hadRows: false };

  const sections = parseEventStandings(loaded.$);
  let hadRows = hasStandingsRows(loaded.$);

  for (const child of childStagePages(loaded.$, game, page)) {
    const childLoaded = await loadTournamentPage(game, child);
    if (!childLoaded) continue;
    const prefix = titleFromPageSegment(child);
    sections.push(...prefixSections(parseEventStandings(childLoaded.$), prefix));
    hadRows = hasStandingsRows(childLoaded.$) || hadRows;
  }

  return { sections, hadRows };
}
