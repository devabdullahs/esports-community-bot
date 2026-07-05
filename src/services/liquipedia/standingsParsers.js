// Pure parsers for Liquipedia STANDINGS formats — the tournament shapes that
// have no head-to-head matches to parse:
//  • panel-table  — the battle-royale framework (PUBG, PUBG Mobile, Free Fire,
//    Fortnite, Apex, Warzone events): rank / team / total points per row, with
//    machine-readable data-sort-val attributes.
//  • group-table  — round-robin group standings (TFT groups and many others):
//    team in the entry cell's aria-label, match score + game score columns.
// No client imports; callers pass a cheerio $.

import { deriveStatus, imageSrc, normalizeImageUrl, teamName } from './parsers.js';

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hasNumericResult(value) {
  return /[1-9]/.test(String(value ?? ''));
}

function rowsHaveResults(sections) {
  return sections.some((section) =>
    (section.entries ?? []).some((entry) => hasNumericResult(entry.points) || hasNumericResult(entry.extra)),
  );
}

// A "TBD" row is an unfilled bracket slot (qualifier not yet decided). We keep
// TBD rows inside a section that has real teams (they fill in as the event
// progresses), but a section with NOTHING but TBD is an unseeded event — storing
// it would show a page of "1. TBD, 2. TBD, ..." and mark the event as having
// standings when it has no content yet.
function isRealTeam(name) {
  const text = cleanText(name);
  return (
    Boolean(text) &&
    !/^tbd$/i.test(text) &&
    !/^(?:group\s+[a-z0-9]+|survival stage|finals?)\s*#\d+$/i.test(text)
  );
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

function battleRoyalePanelTitle($, table) {
  const panel = $(table).closest('.panel-content');
  const navigationRoot = $(table).closest('.tabs-dynamic, .brkts-br-wrapper.battle-royale');
  if (panel.length && navigationRoot.length) {
    const panels = navigationRoot
      .find('.panel-content')
      .toArray()
      .filter((el) => $(el).find('.panel-table').length > 0);
    const primaryTabs = navigationRoot.children('.navigation-tabs').first();
    const labelSource = primaryTabs.length ? primaryTabs : navigationRoot;
    const labels = labelSource
      .find('.navigation-tabs__list-item')
      .map((_, el) => cleanText($(el).text()))
      .get()
      .filter(Boolean);
    const index = panels.indexOf(panel[0]);
    if (index >= 0 && labels[index]) return labels[index];
  }

  const detail = $(table).closest('.panel-content').find('.standings-ffa-detail').first();
  return cleanText(detail.text()) || nearestHeading($, table);
}

function groupDrawLogo($, cell) {
  const imgs = $(cell).find('.team-template-image-icon img, .team-template-logo img, img').toArray();
  for (const img of imgs) {
    if ($(img).closest('.flag').length) continue;
    const url = normalizeImageUrl(imageSrc($(img)));
    if (url) return url;
  }
  return null;
}

function participantLogo($, entry) {
  const imgs = $(entry).find('.team-template-image-icon img, .team-template-logo img, img').toArray();
  for (const img of imgs) {
    if ($(img).closest('.flag, .race').length) continue;
    const url = normalizeImageUrl(imageSrc($(img)));
    if (url) return url;
  }
  return null;
}

function groupDrawHeaders($, row) {
  return $(row)
    .children('th,td')
    .map((_, cell) => cleanText($(cell).text()))
    .get();
}

// Seeded participant groups shown before BR results exist (for example Apex's
// "Group Draw"). These are better for pre-event pages than six all-zero lobby
// standings where the same teams repeat across A-vs-B, C-vs-D, etc.
export function parseBattleRoyaleParticipantGroups($) {
  const sections = [];
  $('table.wikitable').each((_, table) => {
    const rows = $(table).find('tr').toArray();
    if (rows.length < 2) return;
    const headers = groupDrawHeaders($, rows[0]);
    if (headers.length < 2 || !headers.every((header) => /^group\s+[A-Z0-9]+$/i.test(header))) return;

    const byGroup = headers.map((title) => ({ title, entries: [] }));
    for (const row of rows.slice(1)) {
      const cells = $(row).children('td,th').toArray();
      for (let i = 0; i < byGroup.length; i += 1) {
        const cell = cells[i];
        if (!cell) continue;
        const team = teamName($, cell);
        if (!team) continue;
        byGroup[i].entries.push({
          rank: byGroup[i].entries.length + 1,
          team,
          points: '',
          extra: '',
          logo: groupDrawLogo($, cell),
        });
      }
    }

    for (const group of byGroup) {
      if (hasRealTeam(group.entries)) sections.push(group);
    }
  });
  return sections;
}

// Liquipedia participant tables used by individual-player events (fighters,
// chess, etc.). These are not standings yet, but they are the authoritative
// qualified field that weekly picks should list before group/bracket results land.
export function parseParticipantTables($) {
  const sections = [];
  $('.participantTable').each((_, table) => {
    const tableTitle = cleanText($(table).children('.participantTable-title').first().text());
    let current = null;
    for (const row of $(table).children('.participantTable-row').toArray()) {
      const title = cleanText($(row).children('.participantTable-title').first().text());
      if (title) {
        const fullTitle = [tableTitle, title].filter(Boolean).join(': ');
        current = { title: fullTitle, entries: [] };
        sections.push(current);
      }

      for (const entry of $(row).children('.participantTable-entry').not('.participantTable-empty').toArray()) {
        const team =
          cleanText($(entry).find('.block-player .name').first().text()) ||
          cleanText($(entry).find('.name').first().text()) ||
          cleanText($(entry).attr('aria-label'));
        if (!team) continue;
        if (!current) {
          current = { title: tableTitle, entries: [] };
          sections.push(current);
        }
        current.entries.push({
          rank: current.entries.length + 1,
          team,
          points: '',
          extra: '',
          logo: participantLogo($, entry),
        });
      }
    }
  });
  return sections.filter((section) => hasRealTeam(section.entries));
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
        const extraCell = $(row).find('.cell--total-kills, .cell--kills').first();
        const team =
          cleanText(teamCell.attr('data-sort-val')) ||
          cleanText(teamCell.find('.block-team .name').first().text());
        if (!team) return;
        const rank = Number.parseInt(rankCell.attr('data-sort-val') ?? '', 10);
        entries.push({
          rank: Number.isFinite(rank) ? rank : entries.length + 1,
          team,
          points: cleanText(pointsCell.attr('data-sort-val')) || cleanText(pointsCell.text()),
          extra: cleanText(extraCell.attr('data-sort-val')) || cleanText(extraCell.text()),
          logo: normalizeImageUrl(teamCell.find('img').first().attr('src')),
        });
      });
    if (hasRealTeam(entries)) sections.push({ title: battleRoyalePanelTitle($, table), entries });
  });
  return sections;
}

function scheduleExternalId(game, page, section, label) {
  const key = [page, section, label]
    .map((part) =>
      cleanText(part)
        .toLowerCase()
        .replace(/[^a-z0-9/_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean)
    .join(':');
  return `${game}:br-schedule:${key}`;
}

export function parseBattleRoyaleSchedules($, game, page, stageTitle = '') {
  const matches = [];
  $('.panel-table').each((_, table) => {
    const section = battleRoyalePanelTitle($, table);
    if (!section && !stageTitle) return;
    const panel = $(table).closest('.panel-content');
    if (!panel.length) return;
    panel.find('.panel-content__game-schedule__list-item').each((_, item) => {
      const label = cleanText($(item).find('.panel-content__game-schedule__title').first().text()).replace(/:$/, '');
      const scheduledAt = Number($(item).find('[data-timestamp]').first().attr('data-timestamp')) || null;
      if (!label || !scheduledAt) return;
      const parts = [stageTitle, section, label].filter(Boolean);
      const name = parts.join(' - ');
      matches.push({
        source: 'liquipedia',
        externalId: scheduleExternalId(game, page, stageTitle || section, `${section}:${label}`),
        name,
        teamA: name,
        teamB: 'Lobby',
        logoA: null,
        logoB: null,
        scoreA: null,
        scoreB: null,
        bestOf: null,
        scheduledAt,
        status: deriveStatus({ scheduledAt }),
      });
    });
  });
  return matches;
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
  const battleRoyale = parseBattleRoyaleStandings($);
  const participantGroups = parseBattleRoyaleParticipantGroups($);
  const battleRoyaleSections =
    battleRoyale.length && !rowsHaveResults(battleRoyale) && participantGroups.length
      ? participantGroups
      : battleRoyale;
  const structured = [...battleRoyaleSections, ...parseGroupTableStandings($)];
  return structured.length ? structured : parseParticipantTables($);
}

// Whether the page yields at least one PARSEABLE standings row (a team cell we
// can read — TBD counts, since a TBD row is still a recognized standings row).
// This is the clear-vs-preserve confidence signal: it stays true for an all-TBD
// unseeded event (safe to clear stored rows) but goes false the moment the DOM
// shape changes — an empty or restructured table, or renamed row/cell classes,
// extracts nothing, so callers preserve stored rows rather than wipe good data.
// It mirrors the exact team-cell extraction the parsers use above.
export function hasStandingsRows($) {
  let found = false;
  $('.panel-table')
    .find('.panel-table__row')
    .not('.row--header')
    .each((_, row) => {
      const cell = $(row).find('.cell--team').first();
      const team =
        cleanText(cell.attr('data-sort-val')) || cleanText(cell.find('.block-team .name').first().text());
      if (team) {
        found = true;
        return false;
      }
      return undefined;
    });
  if (found) return true;
  $('.group-table')
    .find('.group-table-result-row')
    .each((_, row) => {
      const entry = $(row).find('.group-table-entry').first();
      if (cleanText(entry.attr('aria-label')) || cleanText(entry.text())) {
        found = true;
        return false;
      }
      return undefined;
    });
  if (found) return true;
  $('.participantTable-entry')
    .not('.participantTable-empty')
    .each((_, entry) => {
      if (
        cleanText($(entry).attr('aria-label')) ||
        cleanText($(entry).find('.block-player .name').first().text()) ||
        cleanText($(entry).find('.name').first().text())
      ) {
        found = true;
        return false;
      }
      return undefined;
    });
  if (found) return true;
  $('table.wikitable').each((_, table) => {
    const rows = $(table).find('tr').toArray();
    if (rows.length < 2) return;
    const headers = groupDrawHeaders($, rows[0]);
    if (headers.length < 2 || !headers.every((header) => /^group\s+[A-Z0-9]+$/i.test(header))) return;
    for (const row of rows.slice(1)) {
      const cells = $(row).children('td,th').toArray();
      for (const cell of cells) {
        if (teamName($, cell)) {
          found = true;
          return false;
        }
      }
      if (found) return false;
    }
    return undefined;
  });
  return found;
}
