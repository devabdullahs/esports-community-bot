import * as cheerio from 'cheerio';

import { normalizeTeamName } from '../../lib/render.js';

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numberOrNull(value) {
  const normalized = cleanText(value).replace(/,/g, '');
  return /^-?\d+$/.test(normalized) ? Number(normalized) : null;
}

function splitNumbers(value, count) {
  const parts = cleanText(value).split('/').map(numberOrNull);
  return parts.length === count && parts.every((part) => part !== null) ? parts : Array(count).fill(null);
}

function teamName($, element) {
  const $element = $(element);
  return (
    cleanText($element.find('.team-template-team-icon').first().attr('data-highlighting-class')) ||
    cleanText($element.find('.match-bm-match-header-team-long a, a[title]').first().attr('title')) ||
    cleanText($element.find('.match-bm-match-header-team-long, .name').first().text()) ||
    null
  );
}

function pageTeams($) {
  const teams = $('.match-bm-match-header-opponent').toArray().slice(0, 2).map((element) => teamName($, element));
  return { a: teams[0] ?? null, b: teams[1] ?? null };
}

function sideForTeam(name, teams, fallback) {
  const normalized = normalizeTeamName(name);
  if (normalized && normalized === normalizeTeamName(teams.b)) return 'b';
  if (normalized && normalized === normalizeTeamName(teams.a)) return 'a';
  return fallback;
}

function metadata($) {
  const patch = $('.match-bm-match-additional-section')
    .filter((_, section) => /^patch$/i.test(cleanText($(section).children().first().text())))
    .find('.match-bm-match-additional-section-body')
    .first()
    .text();
  const casterComment = $('.match-bm-match-additional-comment')
    .filter((_, comment) => /^casters\s*:/i.test(cleanText($(comment).text())))
    .first();
  const casters = casterComment.find('a').map((_, link) => cleanText($(link).text())).get().filter(Boolean);
  return {
    patch: cleanText(patch).replace(/^(?:patch|version)\s*/i, '') || null,
    casters,
  };
}

function playerStats($, player) {
  const stats = new Map();
  $(player).find('.match-bm-players-player-stat').each((_, stat) => {
    const label = cleanText($(stat).find('.match-bm-players-player-stat-title').text());
    const data = cleanText($(stat).find('.match-bm-players-player-stat-data').text());
    if (label) stats.set(label, data);
  });
  return stats;
}

function parseValorantPlayer($, player) {
  const stats = playerStats($, player);
  const [kills, deaths, assists] = splitNumbers(stats.get('KDA'), 3);
  const [fk, fd] = splitNumbers(stats.get('FK / FD'), 2);
  const agents = $(player)
    .find('.match-bm-players-player-icon img[alt]')
    .map((_, icon) => cleanText($(icon).attr('alt')))
    .get()
    .filter(Boolean);
  return {
    name: cleanText($(player).find('.match-bm-players-player-name a').first().text()) || null,
    agents,
    acs: numberOrNull(stats.get('ACS')),
    kills,
    deaths,
    assists,
    kastPct: cleanText(stats.get('KAST')) || null,
    adr: numberOrNull(stats.get('ADR')),
    hsPct: cleanText(stats.get('HS%')) || null,
    fk,
    fd,
  };
}

function parseValorantMap($, section, teams) {
  const overview = $(section).find('.match-bm-lol-game-overview').first();
  const scoreText = cleanText(overview.find('.match-bm-lol-game-summary-score').text()).replace(/[‑–—]/g, '-');
  const [scoreA, scoreB] = scoreText.split('-').map(numberOrNull);
  const players = { a: [], b: [] };
  $(section).find('.match-bm-players-wrapper').first().children('.match-bm-players-team').each((index, team) => {
    const side = sideForTeam(teamName($, team), teams, index === 0 ? 'a' : 'b');
    players[side] = $(team).find('.match-bm-players-player').toArray().map((player) => parseValorantPlayer($, player));
  });
  return {
    name: cleanText(overview.find('.match-bm-lol-game-summary-map').text()) || null,
    duration: cleanText(overview.find('.match-bm-lol-game-summary-length').text()) || null,
    scoreA: scoreA ?? null,
    scoreB: scoreB ?? null,
    winner: scoreA === null || scoreB === null || scoreA === scoreB ? null : scoreA > scoreB ? 'a' : 'b',
    players,
  };
}

function parseValorantVeto($, teams) {
  return $('.match-bm-map-veto-card')
    .toArray()
    .map((card, index) => {
      const $card = $(card);
      const cardClass = $card.attr('class') || '';
      const action = /--decider\b/i.test(cardClass) ? 'decider' : /--pick\b/i.test(cardClass) ? 'pick' : 'ban';
      const team = teamName($, $card.find('.team-template-team-icon').first());
      return {
        order: index + 1,
        action,
        map: cleanText($card.find('.match-bm-map-veto-card-map-name').text()) || null,
        team: team ? sideForTeam(team, teams, null) : null,
      };
    })
    .filter((entry) => entry.map);
}

function makePayload(payload, teams) {
  Object.defineProperty(payload, '__pageTeams', { value: teams, enumerable: false, configurable: true });
  return payload;
}

export function parseValorantMatchDetails(html) {
  const $ = cheerio.load(html || '');
  const teams = pageTeams($);
  const mapSections = $('.toggle-area-content-active, .toggle-area-content-inactive')
    .toArray()
    .filter((section) => $(section).find('.match-bm-lol-game-overview').length > 0);
  const veto = parseValorantVeto($, teams);
  const maps = mapSections.map((section) => parseValorantMap($, section, teams));
  if (!veto.length && !maps.length) return null;
  return makePayload({ version: 1, kind: 'valorant', ...metadata($), veto, maps }, teams);
}

function parseDraft($, section, teams) {
  const draft = {
    a: { picks: [], bans: [] },
    b: { picks: [], bans: [] },
  };
  $(section).find('.match-bm-game-veto-wrapper').first().children('.match-bm-lol-game-veto-overview-team').each((index, team) => {
    const side = sideForTeam(teamName($, team), teams, index === 0 ? 'a' : 'b');
    $(team).find('.match-bm-game-veto-overview-team-veto-row').each((_, row) => {
      const kind = /ban/i.test($(row).attr('class') || '') || /bans/i.test($(row).attr('aria-labelledby') || '') ? 'bans' : 'picks';
      $(row).find('.match-bm-game-veto-overview-team-veto-row-item').each((_, item) => {
        const hero = cleanText($(item).find('img[alt]').first().attr('alt')) || cleanText($(item).find('a[title]').first().attr('title'));
        const order = numberOrNull(cleanText($(item).find('.match-bm-game-veto-overview-team-veto-row-item-text').text()).replace('#', ''));
        if (hero) draft[side][kind].push({ hero, order });
      });
    });
  });
  return draft;
}

function parseDotaTeamStats($, section, teams) {
  const teamStats = {
    a: { kills: null, deaths: null, assists: null, gold: null, towers: null, barracks: null, roshans: null },
    b: { kills: null, deaths: null, assists: null, gold: null, towers: null, barracks: null, roshans: null },
  };
  const sides = { a: null, b: null };
  const states = { a: null, b: null };
  const stats = $(section).find('.match-bm-team-stats').first();
  const statTeams = stats.find('.match-bm-team-stats-team').toArray().slice(0, 2);
  statTeams.forEach((team, index) => {
    const side = sideForTeam(teamName($, team), teams, index === 0 ? 'a' : 'b');
    sides[side] = cleanText($(team).find('.match-bm-team-stats-team-side').text()).toLowerCase() || null;
    const state = cleanText($(team).find('.match-bm-team-stats-team-state').attr('data-label-type'));
    states[side] = /win/i.test(state) ? 'win' : /loss/i.test(state) ? 'loss' : null;
  });
  stats.find('.match-bm-team-stats-list-row').each((_, row) => {
    const cells = $(row).children('.match-bm-team-stats-list-cell').toArray();
    if (cells.length < 3) return;
    const label = cleanText($(cells[1]).text()).toLowerCase();
    const values = [cleanText($(cells[0]).text()), cleanText($(cells[2]).text())];
    const sideA = sideForTeam(teamName($, statTeams[0]), teams, 'a');
    const sideB = sideA === 'a' ? 'b' : 'a';
    if (label === 'kda') {
      const [killsA, deathsA, assistsA] = splitNumbers(values[0], 3);
      const [killsB, deathsB, assistsB] = splitNumbers(values[1], 3);
      Object.assign(teamStats[sideA], { kills: killsA, deaths: deathsA, assists: assistsA });
      Object.assign(teamStats[sideB], { kills: killsB, deaths: deathsB, assists: assistsB });
      return;
    }
    const key = label === 'gold' ? 'gold' : ['towers', 'barracks', 'roshans'].includes(label) ? label : null;
    if (!key) return;
    teamStats[sideA][key] = key === 'gold' ? values[0] || null : numberOrNull(values[0]);
    teamStats[sideB][key] = key === 'gold' ? values[1] || null : numberOrNull(values[1]);
  });
  const winner = states.a === 'win' ? 'a' : states.b === 'win' ? 'b' : null;
  return { teamStats, sides, winner, duration: cleanText(stats.find('.match-bm-team-stats-header > div').last().text()) || null };
}

function parseDotaPlayer($, player) {
  const stats = playerStats($, player);
  const [kills, deaths, assists] = splitNumbers(stats.get('KDA'), 3);
  return {
    name: cleanText($(player).find('.match-bm-players-player-name a').first().text()) || null,
    hero:
      cleanText($(player).find('.match-bm-players-player-icon img[alt]').first().attr('alt')) ||
      cleanText($(player).find('.match-bm-players-player-name i').first().text()) ||
      null,
    kills,
    deaths,
    assists,
    dmg: cleanText(stats.get('DMG')) || null,
    lhdn: cleanText(stats.get('LH/DN')) || null,
    net: cleanText(stats.get('NET')) || null,
    gpm: numberOrNull(stats.get('GPM')),
  };
}

function parseDotaGame($, section, teams, number) {
  const { teamStats, sides, winner, duration } = parseDotaTeamStats($, section, teams);
  const players = { a: [], b: [] };
  $(section).find('.match-bm-players-wrapper').first().children('.match-bm-players-team').each((index, team) => {
    const side = sideForTeam(teamName($, team), teams, index === 0 ? 'a' : 'b');
    players[side] = $(team).find('.match-bm-players-player').toArray().map((player) => parseDotaPlayer($, player));
  });
  return { number, winner, duration, sides, draft: parseDraft($, section, teams), teamStats, players };
}

export function parseDota2MatchDetails(html) {
  const $ = cheerio.load(html || '');
  const teams = pageTeams($);
  const gameSections = $('.toggle-area-content-active, .toggle-area-content-inactive')
    .toArray()
    .filter((section) => $(section).find('.match-bm-game-veto-wrapper, .match-bm-team-stats').length > 0);
  const games = gameSections.map((section, index) => parseDotaGame($, section, teams, index + 1));
  if (!games.length) return null;
  return makePayload({ version: 1, kind: 'dota2', ...metadata($), games }, teams);
}

export function parseMatchDetails(game, html) {
  if (game === 'valorant') return parseValorantMatchDetails(html);
  if (game === 'dota2') return parseDota2MatchDetails(html);
  return null;
}

function swapSides(payload) {
  const flip = (side) => (side === 'a' ? 'b' : side === 'b' ? 'a' : side);
  if (payload.kind === 'valorant') {
    payload.veto = payload.veto.map((entry) => ({ ...entry, team: flip(entry.team) }));
    payload.maps = payload.maps.map((map) => ({
      ...map,
      scoreA: map.scoreB,
      scoreB: map.scoreA,
      winner: flip(map.winner),
      players: { a: map.players.b, b: map.players.a },
    }));
  }
  if (payload.kind === 'dota2') {
    payload.games = payload.games.map((game) => ({
      ...game,
      winner: flip(game.winner),
      sides: { a: game.sides.b, b: game.sides.a },
      draft: { a: game.draft.b, b: game.draft.a },
      teamStats: { a: game.teamStats.b, b: game.teamStats.a },
      players: { a: game.players.b, b: game.players.a },
    }));
  }
  const teams = payload.__pageTeams;
  if (teams) {
    Object.defineProperty(payload, '__pageTeams', {
      value: { a: teams.b, b: teams.a },
      enumerable: false,
      configurable: true,
    });
  }
  return payload;
}

export function alignMatchDetailsSides(payload, { teamA, teamB } = {}) {
  const teams = payload?.__pageTeams;
  if (!payload || !teams || !teamA || !teamB) return payload;
  const same = (left, right) => Boolean(normalizeTeamName(left) && normalizeTeamName(left) === normalizeTeamName(right));
  const direct = Number(same(teams.a, teamA)) + Number(same(teams.b, teamB));
  const reversed = Number(same(teams.a, teamB)) + Number(same(teams.b, teamA));
  return reversed > direct ? swapSides(payload) : payload;
}
