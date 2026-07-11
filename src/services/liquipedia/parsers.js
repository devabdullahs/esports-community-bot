// Pure HTML parser functions — no imports from client or rateState.
// Each takes a cheerio `$` (and optionally the element/game) and returns plain data.

import { ewcPlacementPoints, normalizeClubName } from '../../lib/ewcPredictions.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function normalizeImageUrl(src) {
  if (!src || src.startsWith('data:')) return null;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `https://liquipedia.net${src}`;
  if (/^https?:\/\//i.test(src)) return src;
  return null;
}

export function normalizePageUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://liquipedia.net${href}`;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

export function imageSrc($img) {
  const srcset = $img.attr('srcset')?.split(',')[0]?.trim()?.split(/\s+/)[0];
  return $img.attr('data-src') || $img.attr('src') || srcset || null;
}

export function teamLogo($, el) {
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

// Liquipedia appends "(page does not exist)" to names whose wiki page is missing. Strip it.
export const cleanName = (s) =>
  String(s ?? '')
    .replace(/[​-‏﻿]/g, '')
    .replace(/\(page does not exist\)/gi, '')
    .replace(/\((?:[^)]*?\s)?stack\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

export const isPlaceholderTeam = (s) => {
  const name = cleanName(s);
  return !name || /^TBD$/i.test(name);
};

// A match that started in the recent past with no recorded result yet is treated as live for
// this long. (Liquipedia serves true live status/scores client-side, so they are NOT present in
// the static action=parse HTML — this is the best "currently being played" signal we have.)
const LIVE_WINDOW_S = 4 * 3600;

const nowSec = () => Math.floor(Date.now() / 1000);

// Shared status logic for brackets, match lists, and the upcoming-matches widget.
export function deriveStatus({
  winA = false,
  winB = false,
  scoreA,
  scoreB,
  bestOf,
  scheduledAt,
  placeholder = false,
  live = false,
}) {
  const winAt = bestOf ? Math.floor(bestOf / 2) + 1 : null;
  const played = (scoreA ?? 0) + (scoreB ?? 0);
  const reachedWin = winAt != null && ((scoreA ?? 0) >= winAt || (scoreB ?? 0) >= winAt);
  if (bestOf) {
    if (reachedWin || played >= bestOf) return 'finished';
    if (played > 0) return 'running';
  }
  if (winA || winB) return 'finished';
  if (played > 0) return 'running'; // has a partial score → in progress
  if (live) return 'running';
  if (placeholder) return 'scheduled';
  const now = nowSec();
  if (scheduledAt && now >= scheduledAt && now - scheduledAt <= LIVE_WINDOW_S) return 'running';
  if (scheduledAt && now > scheduledAt + LIVE_WINDOW_S) return 'finished';
  return 'scheduled';
}

// Resolve a team's full name from a Liquipedia team-template cell.
export function teamName($, cell) {
  const $c = $(cell);
  const raw =
    $c.find('[data-highlightingclass]').attr('data-highlightingclass') ||
    $c.find('a[title]').last().attr('title') ||
    $c.find('a').last().text() ||
    $c.text();
  return raw.replace(/\(page does not exist\)/i, '').replace(/\s+/g, ' ').trim();
}

// Extract a single integer score from a bracket/matchlist score cell, tolerating
// surrounding whitespace/markup (a stray <sup>, a non-breaking space, etc.).
// Returns null for an empty or non-numeric cell — e.g. an unplayed slot, or a
// 'W'/'FF' walkover marker that carries no series score (never fabricate one).
function parseScoreCell(text) {
  const m = String(text ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

function parseMatchlistScorePair($, cells) {
  const cellScores = [];
  $(cells).each((_i, cell) => {
    const raw = $(cell).text().replace(/\s+/g, ' ').trim();
    const score = parseScoreCell(raw);
    cellScores.push(score);
  });
  if (cellScores.length <= 2) return [cellScores[0] ?? null, cellScores[1] ?? null];

  const scores = cellScores.filter((score) => score != null);
  if (scores.length < 2) return [scores[0] ?? null, null];
  return [scores[0], scores[scores.length - 1]];
}

// Stable fallback id for a bracket/matchlist match that has NO Liquipedia
// "Match:" page link. Keyed on the structural scope (tournament page + row/list
// position, when available) + the team PAIR (order-independent) — deliberately
// NOT the scheduled time. A rescheduled match then keeps the same id and updates
// one row, while separate rematches in the same tournament can still coexist.
// Matches that DO link a Match: page keep that stable id and are unaffected by this.
function fallbackMatchId(game, scope, teamA, teamB) {
  const pair = [teamA, teamB]
    .map((t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase())
    .sort()
    .join(' vs ');
  return `${game}:${scope || 'unknown'}:${pair}`;
}

// Liquipedia can mark rows as live without exposing a timestamp or score in
// action=parse HTML. Trust only local timer/status badges inside the match row.
function hasLiveMarker($, el) {
  return $(el)
    .find(
      '.timer-object, .timer, .live-icon, .match-countdown, .match-info-status, .match-live, .brkts-live, [class~="live"]',
    )
    .toArray()
    .some((node) => {
      const text = cleanName($(node).text());
      const klass = String($(node).attr('class') ?? '');
      const title = String($(node).attr('title') ?? '');
      const label = String($(node).attr('aria-label') ?? '');
      return /\blive\b/i.test(`${text} ${title} ${label}`) || /(^|[-_\s])live($|[-_\s])/i.test(klass);
    });
}

// ---------------------------------------------------------------------------
// Match parsers
// ---------------------------------------------------------------------------

// The per-match OFFICIAL broadcast stream, when Liquipedia tags one on the match.
// It's encoded as an internal redirect anchor inside the match's stream button /
// popup footer: <a href="/<wiki>/Special:Stream/<platform>/<channel>">. Liquipedia
// only attaches it while the match is actually being streamed, so its presence is a
// strong "watch this live now" signal.
//
// The <channel> segment is Liquipedia's stream-page KEY, NOT necessarily the real
// channel handle (e.g. /Special:Stream/twitch/Overwatch_Esports resolves to
// twitch.tv/ow_esports). So the watch link must go through Liquipedia's
// Special:Stream page, which performs the redirect — building twitch.tv/<key>
// directly would point at the wrong (or a non-existent) account.
// Returns { platform, url } (url is always a liquipedia.net Special:Stream link) or null.
export function parseMatchStream($, el) {
  const href = $(el).find('a[href*="/Special:Stream/"]').first().attr('href') || '';
  // Only accept a Liquipedia-relative path. Real Special:Stream links always are;
  // rejecting absolute / protocol-relative hrefs stops a community-edited external
  // anchor from making our "Watch now" link point off-site.
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  const m = href.match(/\/Special:Stream\/([^/]+)\/[^/?#]+/i);
  if (!m) return null;
  const platform = decodeURIComponent(m[1]).toLowerCase();
  if (!platform) return null;
  return { platform, url: `https://liquipedia.net${href}` };
}

// Parse a single .match-info element into a normalized match.
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
  const live = hasLiveMarker($, el);
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
    const status = deriveStatus({ scheduledAt, live });
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

  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const matchId = matchHref.split('/').pop() || null;
  const externalId = matchId || `${game}:${scheduledAt}:${teamA}:${teamB}`;

  const status = deriveStatus({ scoreA, scoreB, bestOf, scheduledAt, live });

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
    stream: parseMatchStream($, el),
    tournamentPath,
    tournamentName,
  };
}

export function mergeLiveWidgetMatch(existing, liveMatch) {
  const existingHasScoredResult =
    existing.status === 'finished' && existing.scoreA != null && existing.scoreB != null;

  if (liveMatch.status === 'running' && !existingHasScoredResult) {
    existing.status = 'running';
    existing.winner = null;
    if (liveMatch.scoreA != null) existing.scoreA = liveMatch.scoreA;
    if (liveMatch.scoreB != null) existing.scoreB = liveMatch.scoreB;
    if (!existing.scheduledAt && liveMatch.scheduledAt) existing.scheduledAt = liveMatch.scheduledAt;
    return true;
  }

  if (
    liveMatch.status === 'finished' &&
    existing.status !== 'finished' &&
    existing.scoreA == null &&
    existing.scoreB == null &&
    liveMatch.scheduledAt
  ) {
    // Some widgets keep already-played matches in "Upcoming" with no score/winner.
    // If the same pair is far past its start, retire the unresolved bracket row too.
    existing.status = 'finished';
    if (!existing.scheduledAt) existing.scheduledAt = liveMatch.scheduledAt;
    return true;
  }

  return false;
}

// Parse one bracket/matchlist match (.brkts-match).
export function parseBracketMatch($, el, game, scope = '') {
  const $m = $(el);
  const entries = $m.find('.brkts-opponent-entry');
  if (entries.length < 2) return null;

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
  const scoreA = scoreEls[0] ? parseScoreCell($(scoreEls[0]).text()) : null;
  const scoreB = scoreEls[1] ? parseScoreCell($(scoreEls[1]).text()) : null;

  const winA = $(entries[0]).find('.brkts-opponent-win').length > 0;
  const winB = $(entries[1]).find('.brkts-opponent-win').length > 0;

  const scheduledAt = Number($m.find('[data-timestamp]').attr('data-timestamp')) || null;
  const bestOf = Number($m.find('.brkts-popup').text().match(/\(Bo(\d+)\)/i)?.[1]) || null;
  const live = hasLiveMarker($, el);

  const status = deriveStatus({
    winA,
    winB,
    scoreA,
    scoreB,
    bestOf,
    scheduledAt,
    placeholder: isPlaceholderTeam(teamA) || isPlaceholderTeam(teamB),
    live,
  });

  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const externalId = matchHref.split('/').pop() || fallbackMatchId(game, scope, teamA, teamB);

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
    stream: parseMatchStream($, el),
    winner: winA ? teamA : winB ? teamB : null,
  };
}

// Parse one match-list row (.brkts-matchlist-match).
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
  const [scoreA, scoreB] = parseMatchlistScorePair($, scoreEls);

  const winA = $(opps[0]).hasClass('brkts-matchlist-slot-winner');
  const winB = $(opps[1]).hasClass('brkts-matchlist-slot-winner');

  const scheduledAt = Number($m.find('[data-timestamp]').attr('data-timestamp')) || null;
  const bestOf = Number($m.find('.brkts-popup').text().match(/\(Bo(\d+)\)/i)?.[1]) || null;
  const live = hasLiveMarker($, el);
  const status = deriveStatus({
    winA,
    winB,
    scoreA,
    scoreB,
    bestOf,
    scheduledAt,
    placeholder: isPlaceholderTeam(teamA) || isPlaceholderTeam(teamB),
    live,
  });

  const matchHref = $m.find('a[href*="/Match:"]').attr('href') || '';
  const externalId = matchHref.split('/').pop() || fallbackMatchId(game, scope, teamA, teamB);

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
    stream: parseMatchStream($, el),
    winner: winA ? teamA : winB ? teamB : null,
  };
}

// Parse Swiss-stage standings grids (table.swisstable).
export function parseSwissMatches($, game) {
  const out = [];
  const seen = new Set();
  $('.swisstable').each((_t, table) => {
    $(table)
      .find('tr')
      .slice(1)
      .each((_r, row) => {
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

        $(row)
          .find('td[class*="swisstable-bgc"]')
          .each((_c, cell) => {
            const $cell = $(cell);
            const sc = $cell.text().match(/(\d+)\s*[:\-]\s*(\d+)/);
            if (!sc) return;
            const scoreA = Number(sc[1]);
            const scoreB = Number(sc[2]);
            if (scoreA === 0 && scoreB === 0) return;
            const opp = teamName($, cell);
            if (!opp || opp === 'TBD' || opp.toLowerCase() === rowTeam.toLowerCase()) return;
            const oppLogo = teamLogo($, cell);
            const pairKey = [rowTeam.toLowerCase(), opp.toLowerCase()].sort().join('|');
            if (seen.has(pairKey)) return;
            seen.add(pairKey);
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

// ---------------------------------------------------------------------------
// EWC Club Championship parsers
// ---------------------------------------------------------------------------

// Liquipedia marks Club Championship eligibility with colored backgrounds.
function detectEligibility($, teamCell, row) {
  const $team = $(teamCell);
  const $row = $(row);
  const described = $row
    .find('[title], [data-bs-title], [aria-label]')
    .toArray()
    .flatMap((element) => [$(element).attr('title'), $(element).attr('data-bs-title'), $(element).attr('aria-label')])
    .filter(Boolean)
    .join(' ');
  const blob = `${$team.attr('class') || ''} ${$team.attr('style') || ''} ${$row.attr('class') || ''} ${$row.attr('style') || ''} ${described}`.toLowerCase();
  if (/not (?:yet )?eligible|has not qualified/.test(blob)) return null;
  if (/eligible to win (?:the )?(?:club )?championship|two top\s*8[^.]*tournament win/.test(blob)) return 'champion';
  if (/eligible for (?:the )?(?:club championship|prize pool)|two top\s*8/.test(blob)) return 'prize';
  if (/yellow|gold/.test(blob)) return 'champion';
  if (/green/.test(blob)) return 'prize';
  return null;
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
    const eventPoints = cells
      .toArray()
      .map((cell, index) => ({ index, value: Number($(cell).text().replace(/[^0-9]/g, '')) }))
      .filter(({ index, value }) => index > idxPoints && Number.isFinite(value) && value > 0)
      .map(({ value }) => value);
    const wins = eventPoints.filter((value) => value === 1000).length;
    const topEightFinishes = eventPoints.length;
    const markedEligibility = detectEligibility($, cells[idxTeam], row);
    const derivedEligibility = topEightFinishes >= 2 ? (wins > 0 ? 'champion' : 'prize') : null;
    out.push({ rank, team, points, wins, topEightFinishes, eligibility: markedEligibility || derivedEligibility });
  }
  return out;
}

// Parse the prize-pool csstable-widget.
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

// ---------------------------------------------------------------------------
// EWC 2026 club / roster catalog parsers
// ---------------------------------------------------------------------------

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

export function normalizeEwcGameLabel(label) {
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

// ---------------------------------------------------------------------------
// EWC event schedule parsers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Valve Regional Standings parsers
// ---------------------------------------------------------------------------

export const VRS_REGIONS = {
  global: { label: 'Global', tableIndex: 0 },
  europe: { label: 'Europe', tableIndex: 1 },
  americas: { label: 'Americas', tableIndex: 2 },
  asia: { label: 'Asia', tableIndex: 3 },
};

export const valveRankingRegions = Object.keys(VRS_REGIONS);

export function normalizeValveRankingRegion(region) {
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

export function parseValveRankingTable($, table, region) {
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

// ---------------------------------------------------------------------------
// EWC per-game weekly results parsers
// ---------------------------------------------------------------------------

function playerName($, el) {
  const $el = $(el);
  return cleanName(
    $el.find('.name').first().text() ||
      $el.find('a[title]').first().attr('title') ||
      $el.text(),
  );
}

// Map a player id -> club, scoped by game when possible. Used to resolve solo
// games (fighters, chess, etc.) where the prizepool row lists a player, not a
// team block, back to the EWC club that fielded them.
function buildEwcPlayerClubLookup(players) {
  const byPlayer = new Map();
  for (const player of players || []) {
    if (!player.id || !player.team || player.team === 'TBD') continue;
    const gameKey = normalizeClubName(player.game);
    const idKey = normalizeClubName(player.id);
    byPlayer.set(`${gameKey}:${idKey}`, player.team);
    if (!byPlayer.has(idKey)) byPlayer.set(idKey, player.team);
  }
  return byPlayer;
}

function playerClubFor(lookup, game, player) {
  const idKey = normalizeClubName(player);
  return lookup.get(`${normalizeClubName(game)}:${idKey}`) || lookup.get(idKey) || null;
}

function addUniqueClub(clubs, club, participant = null) {
  const name = cleanName(club);
  if (!name || name === 'TBD') return;
  const key = normalizeClubName(name);
  if (clubs.some((entry) => normalizeClubName(entry.club) === key)) return;
  clubs.push({ club: name, participant });
}

function clubsFromPrizepoolRow($, row, game, playerLookup) {
  const clubs = [];
  const $row = $(row);

  $row.find('.block-team').each((_i, el) => addUniqueClub(clubs, teamName($, el)));
  $row.find('.team-template').each((_i, el) => addUniqueClub(clubs, teamName($, el)));

  $row.find('.block-player').each((_i, el) => {
    const player = playerName($, el);
    const club = playerClubFor(playerLookup, game, player);
    if (club) addUniqueClub(clubs, club, player);
  });

  return clubs;
}

// Parse a Liquipedia event prizepool table into normalized per-club placements.
// `event` carries the game label so solo games can be mapped via the player list.
export function parseEwcEventPlacements($, event, players = []) {
  const table = $('.prizepooltable').first();
  if (!table.length) return [];
  const playerLookup = buildEwcPlayerClubLookup(players);
  const byClub = new Map();

  table.find('.csstable-widget-row').each((_i, row) => {
    const $row = $(row);
    if ($row.hasClass('prizepooltable-header')) return;
    const place = $row.find('.prizepooltable-place').first().text().replace(/\s+/g, ' ').trim();
    const points = ewcPlacementPoints(place);
    if (!place || !points) return;

    for (const entry of clubsFromPrizepoolRow($, row, event.game, playerLookup)) {
      const key = normalizeClubName(entry.club);
      const existing = byClub.get(key);
      if (existing && existing.points >= points) continue;
      byClub.set(key, {
        club: entry.club,
        place,
        points,
        participant: entry.participant,
      });
    }
  });

  return [...byClub.values()].sort((a, b) => b.points - a.points || a.club.localeCompare(b.club));
}

export function parseTournamentEwcAffiliation($) {
  const infobox = $('.fo-nttax-infobox, .infobox, .infobox-center, .tournament-infobox').first();
  const text = (infobox.length ? infobox.text() : $.text()).replace(/\s+/g, ' ').trim();
  return /(?:Esports\s*World\s*Cup|EWC)\s*Foundation/i.test(text);
}
