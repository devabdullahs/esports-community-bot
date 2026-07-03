// Pure parsers for Liquipedia STANDINGS formats — the tournament shapes that
// have no head-to-head matches to parse:
//  • panel-table  — the battle-royale framework (PUBG, PUBG Mobile, Free Fire,
//    Fortnite, Apex, Warzone events): rank / team / total points per row, with
//    machine-readable data-sort-val attributes.
//  • group-table  — round-robin group standings (TFT groups and many others):
//    team in the entry cell's aria-label, match score + game score columns.
// No client imports; callers pass a cheerio $.

import { normalizeImageUrl } from './parsers.js';

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// A "TBD" row is an unfilled bracket slot (qualifier not yet decided). We keep
// TBD rows inside a section that has real teams (they fill in as the event
// progresses), but a section with NOTHING but TBD is an unseeded event — storing
// it would show a page of "1. TBD, 2. TBD, ..." and mark the event as having
// standings when it has no content yet.
function isRealTeam(name) {
  const text = cleanText(name);
  return Boolean(text) && !/^tbd$/i.test(text);
}

function hasRealTeam(entries) {
  return entries.some((entry) => isRealTeam(entry.team));
}

function nearestHeading($, el) {
  const heading = $(el).prevAll('h2, h3, h4').first();
  if (heading.length) return cleanText(heading.find('.mw-headline').text() || heading.text());
  const parentHeading = $(el).parent().prevAll('h2, h3, h4').first();
  return parentHeading.length
    ? cleanText(parentHeading.find('.mw-headline').text() || parentHeading.text())
    : '';
}

// Battle-royale panel-table(s). Returns one section per table:
// { title, entries: [{ rank, team, points, logo }] }. TBD rows are kept (they
// become real teams as qualifiers finish) but rows with no team text at all are
// dropped, and a table that is ENTIRELY TBD (an unseeded event) yields no
// section at all.
export function parseBattleRoyaleStandings($) {
  const sections = [];
  $('.panel-table').each((_, table) => {
    const entries = [];
    $(table)
      .find('.panel-table__row')
      .not('.row--header')
      .each((_, row) => {
        const rankCell = $(row).find('.cell--rank').first();
        const teamCell = $(row).find('.cell--team').first();
        const pointsCell = $(row).find('.cell--total-points').first();
        const team =
          cleanText(teamCell.attr('data-sort-val')) ||
          cleanText(teamCell.find('.block-team .name').first().text());
        if (!team) return;
        const rank = Number.parseInt(rankCell.attr('data-sort-val') ?? '', 10);
        entries.push({
          rank: Number.isFinite(rank) ? rank : entries.length + 1,
          team,
          points: cleanText(pointsCell.attr('data-sort-val')) || cleanText(pointsCell.text()),
          logo: normalizeImageUrl(teamCell.find('img').first().attr('src')),
        });
      });
    if (hasRealTeam(entries)) sections.push({ title: nearestHeading($, table), entries });
  });
  return sections;
}

// Round-robin group tables. Returns one section per group:
// { title: "Group A", entries: [{ rank, team, points: matchScore, extra: gameScore, logo }] }.
export function parseGroupTableStandings($) {
  const sections = [];
  $('.group-table').each((_, table) => {
    const title = cleanText($(table).find('.group-table-title').first().text());
    const entries = [];
    $(table)
      .find('.group-table-result-row')
      .each((_, row) => {
        const entryCell = $(row).find('.group-table-entry').first();
        const team = cleanText(entryCell.attr('aria-label')) || cleanText(entryCell.text());
        if (!team) return;
        const rankText = cleanText($(row).find('.group-table-rank').first().text());
        const rank = Number.parseInt(rankText.replace(/\D/g, ''), 10);
        entries.push({
          rank: Number.isFinite(rank) && rank > 0 ? rank : entries.length + 1,
          team,
          points: cleanText($(row).find('.group-table-match-score').first().text()),
          extra: cleanText($(row).find('.group-table-game-score').first().text()),
          logo: normalizeImageUrl(entryCell.find('img').first().attr('src')),
        });
      });
    if (hasRealTeam(entries)) sections.push({ title, entries });
  });
  return sections;
}

// Every standings section on a tournament page, in page order per format.
export function parseEventStandings($) {
  return [...parseBattleRoyaleStandings($), ...parseGroupTableStandings($)];
}
