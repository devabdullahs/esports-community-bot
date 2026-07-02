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

// Active roster from a team page: the first roster-card table (Liquipedia lists
// the active squad first; "Former" squads come in later tables/sections). Each
// row links the player's wiki page — that link is what lets the enrichment job
// walk team -> players without any name guessing.
export function parseTeamRoster($, { limit = 20 } = {}) {
  const table = $('table.roster-card').first();
  if (!table.length) return [];

  const players = [];
  table.find('tr').each((_, row) => {
    if (players.length >= limit) return false;
    const idCell = $(row).find('td.ID').first();
    const link = idCell.find('a').filter((_, a) => {
      const href = $(a).attr('href') || '';
      return href.startsWith('/') && !href.includes('index.php') && !$(a).find('img').length;
    }).first();
    const name = cleanText(link.length ? link.text() : idCell.text());
    if (!name) return;
    const href = link.attr('href') || null;
    const position = cleanText($(row).find('td.Position, td.PositionWoTeam2').first().text()) || null;
    players.push({
      name,
      page: href ? decodeURIComponent(href.replace(/^\/[^/]+\/(?:index\.php\?title=)?/, '')) : null,
      role: position ? position.replace(/^position:?\s*/i, '') || null : null,
    });
  });
  return players;
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
