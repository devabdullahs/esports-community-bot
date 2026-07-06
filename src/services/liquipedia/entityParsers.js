// Pure parsers for Liquipedia ENTITY pages (team/player), no client imports.
// Liquipedia renders the same infobox framework on every wiki (fo-nttax-infobox
// with infobox-cell-2 label/value pairs), so one generic parser covers valorant,
// battle-royale wikis, TFT, and the rest — the extracted facts are a label→text
// dictionary plus a few normalized conveniences.

import { normalizeImageUrl } from './parsers.js';

function cleanText(value) {
  return String(value ?? '')
    .replace(/\[\d+\]/g, '') // strip footnote markers
    .replace(/\s+/g, ' ')
    .trim();
}

function labelKey(label) {
  return cleanText(label)
    .replace(/:$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// The infobox as {key: text} plus the header image. Keys are normalized labels:
// "Approx. Total Winnings:" -> approx_total_winnings.
export function parseEntityInfobox($) {
  const box = $('.fo-nttax-infobox').first();
  if (!box.length) return null;

  const facts = {};
  box.find('.infobox-cell-2.infobox-description').each((_, el) => {
    const label = labelKey($(el).text());
    if (!label) return;
    const value = cleanText($(el).next().text());
    if (value) facts[label] = value;
  });

  const image = normalizeImageUrl(box.find('.infobox-image img').first().attr('src'));
  const name = cleanText(box.find('.infobox-header').first().clone().children('span').remove().end().text());

  return { name: name || null, image: image || null, facts };
}

function findInfoboxSection($, heading) {
  const target = String(heading ?? '').trim().toLowerCase();
  if (!target) return null;
  const header = $('.fo-nttax-infobox .infobox-header').filter((_, el) => (
    cleanText($(el).clone().children('span').remove().end().text()).toLowerCase() === target
  )).first();
  if (!header.length) return null;
  const section = header.parent().next();
  return section.length ? section : null;
}

export function parsePlayerInfoboxDetails($, { historyLimit = 12, achievementLimit = 8 } = {}) {
  const achievements = [];
  const achievementSection = findInfoboxSection($, 'Achievements');
  if (achievementSection) {
    achievementSection.find('a').each((_, link) => {
      if (achievements.length >= achievementLimit) return false;
      const $link = $(link);
      const img = $link.find('img').first();
      const title = cleanText($link.attr('title') || img.attr('alt') || $link.text());
      const image = normalizeImageUrl(img.attr('src'));
      if (!title && !image) return;
      achievements.push({ title: title || null, image: image || null });
    });
  }

  const history = [];
  const historySection = findInfoboxSection($, 'History');
  if (historySection) {
    historySection.find('tr').each((_, row) => {
      if (history.length >= historyLimit) return false;
      const cells = $(row).children('td');
      if (cells.length < 2) return;
      const period = cleanText(cells.eq(0).text()).replace(/\s*—\s*/g, ' — ');
      const teamLink = cells.eq(1).find('a').last();
      const team = cleanText(teamLink.length ? teamLink.text() : cells.eq(1).text());
      if (!period || !team) return;
      history.push({ period, team });
    });
  }

  return { achievements, history };
}

// The ACTIVE roster table on a team page, across both Liquipedia markups:
//  - legacy `table.roster-card` (td.ID / td.Position cells), and
//  - the current `table2` component (<table class="table2__table"> with a
//    header row of ID | Name | Position | Join Date).
// In both formats the active squad is the FIRST roster-shaped table on the page;
// "Former" tables carry Leave Date / New Team columns and are rejected outright
// (never just ordered after), so a page whose active squad section is missing
// can't silently yield ex-players. Exported so fetchTeamEntity can store the
// same fragment it parsed (raw re-extraction without another request).
export function findTeamRosterTable($) {
  const legacy = $('table.roster-card').first();
  if (legacy.length) return legacy;

  const candidates = $('table[class*="table2__table"]').filter((_, table) => {
    const head = tableHeaderCells($, table).map((cell) => cell.toLowerCase());
    if (!head.includes('id')) return false;
    if (head.some((cell) => /leave date|new team|inactive/.test(cell))) return false;
    return head.some((cell) => /position|role|join date/.test(cell));
  });
  return candidates.length ? candidates.first() : null;
}

function tableHeaderCells($, table) {
  const headRow = $(table).find('tr').first();
  return headRow
    .children('th,td')
    .map((_, cell) => cleanText($(cell).text()))
    .get();
}

// Active roster from a team page (see findTeamRosterTable for format handling).
// Each row links the player's wiki page — that link is what lets the enrichment
// job walk team -> players without any name guessing.
// Returns { players, truncated }: `truncated` means the cap cut real rows off,
// so the caller must NOT treat absence from `players` as "left the team".
export function parseTeamRoster($, { limit = 20 } = {}) {
  const table = findTeamRosterTable($);
  if (!table || !table.length) return { players: [], truncated: false };
  const isLegacy = table.is('table.roster-card');

  // table2 rows carry no ID/Position cell classes — locate columns by header.
  const header = tableHeaderCells($, table).map((cell) => cell.toLowerCase());
  const idIndex = Math.max(0, header.indexOf('id'));
  const positionIndex = header.findIndex((cell) => /position|role/.test(cell));

  const players = [];
  table.find('tr').each((_, row) => {
    const rowClass = String($(row).attr('class') ?? '');
    if (/row--head/.test(rowClass) || $(row).children('th').length) return;

    const cells = $(row).children('td');
    const idCell = isLegacy ? $(row).find('td.ID').first() : cells.eq(idIndex);
    if (!idCell.length) return;
    const link = idCell.find('a').filter((_, a) => {
      const href = $(a).attr('href') || '';
      return href.startsWith('/') && !href.includes('index.php') && !$(a).find('img').length;
    }).first();
    const name = cleanText(link.length ? link.text() : idCell.text());
    if (!name) return;
    const href = link.attr('href') || null;
    const positionCell = isLegacy
      ? $(row).find('td.Position, td.PositionWoTeam2').first()
      : positionIndex >= 0
        ? cells.eq(positionIndex)
        : null;
    const position = positionCell ? cleanText(positionCell.text()) || null : null;
    players.push({
      name,
      page: href ? decodeURIComponent(href.replace(/^\/[^/]+\/(?:index\.php\?title=)?/, '')) : null,
      role: position ? position.replace(/^position:?\s*/i, '') || null : null,
    });
  });
  return { players: players.slice(0, limit), truncated: players.length > limit };
}

// Normalized conveniences pulled out of the raw facts dictionary. Everything
// else stays available in facts for future use without re-fetching.
export function normalizeEntityFacts(facts) {
  if (!facts) return {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (facts[key]) return facts[key];
    }
    return null;
  };
  return {
    location: pick('location', 'country'),
    region: pick('region'),
    nationality: pick('nationality', 'country'),
    role: pick('role', 'roles', 'position'),
    team: pick('team', 'current_team'),
    romanizedName: pick('romanized_name'),
    born: pick('born', 'birth'),
    // Stored for the record; NOT displayed until the licensing review clears it.
    totalWinnings: pick('approx_total_winnings', 'total_winnings', 'earnings'),
    created: pick('created', 'founded'),
    coach: pick('coach', 'head_coach'),
  };
}
