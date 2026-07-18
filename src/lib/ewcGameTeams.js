import { categoryToGameSlug, fightersTag, gameSlugFromName, isLobbyGame, isKnownGameSlug, normalizeGameSlug } from './games.js';
import { normalizeClubName } from './ewcPredictions.js';
import { listStandingsTeamRowsForGame } from '../db/tournamentStandings.js';
import { listTrackedTeamRowsForGame } from '../db/matches.js';
import { listEwcTournamentsForGame } from '../db/tournaments.js';

// Junk rows the BR/lobby schedule parser stores in `matches` (team_a = "Group A -
// Game 3", team_b = "Lobby", "… - Match"). These are never real teams, so keep them
// out of the weekly-pick option list. Standings rows are already clean participants.
function looksLikeScheduleRow(name) {
  return /\bgame\s*\d+\b/i.test(name) || /\bmatch$/i.test(name) || /^lobby$/i.test(name);
}

// Resolve a week's game NAME to our game slug. EWC schedule names carry version /
// edition suffixes our registry doesn't ("Counter-Strike 2", "Overwatch 2",
// "Rainbow Six Siege", "EA SPORTS FC 26", "Call of Duty: Warzone"), so fall back
// to the tolerant stream-category resolver, which handles exactly those shapes.
function slugForGameName(gameName) {
  const raw = String(gameName ?? '').trim();
  if (!raw) return null;
  const slug = gameSlugFromName(raw) || categoryToGameSlug(raw) || normalizeGameSlug(raw.toLowerCase());
  return slug && isKnownGameSlug(slug) ? normalizeGameSlug(slug) : slug || null;
}

function eventPathFromUrl(eventUrl) {
  if (!eventUrl) return null;
  try {
    const url = new URL(eventUrl);
    if (!/liquipedia\.net$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0].toLowerCase()}/${parts.slice(1).join('/')}`.toLowerCase();
  } catch {
    return null;
  }
}

function eventNameTokens(value) {
  const ignored = new Set(['2026', 'esports', 'world', 'cup', 'the', 'and', 'for']);
  return new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !ignored.has(token)));
}

function resultPageUrl(slug, url) {
  if (normalizeGameSlug(slug) !== 'apexlegends' || !url) return url;
  try {
    const parsed = new URL(url);
    if (!/liquipedia\.net$/i.test(parsed.hostname)) return url;
    if (/\/Playoffs\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/Finals`;
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

export async function resolveEwcGameEventUrl(gameName, { guildId, eventUrl = null, eventName = null } = {}) {
  const slug = slugForGameName(gameName);
  if (!slug || !guildId) return eventUrl;
  const rows = await listEwcTournamentsForGame(guildId, slug).catch(() => []);
  const liquipediaRows = rows.filter((row) => row.source === 'liquipedia' && eventPathFromUrl(row.url));
  if (!liquipediaRows.length) return eventUrl;

  const requestedPath = eventPathFromUrl(eventUrl);
  const exact = requestedPath
    ? liquipediaRows.find((row) => eventPathFromUrl(row.url) === requestedPath)
    : null;
  if (exact) return resultPageUrl(slug, exact.url);

  if (normalizeGameSlug(slug) === 'fighters') {
    const wanted = fightersTag(gameName);
    const tagged = liquipediaRows.find((row) => fightersTag(row.name) === wanted);
    if (tagged) return resultPageUrl(slug, tagged.url);
  }
  const wantedTokens = eventNameTokens(eventName);
  if (wantedTokens.size) {
    const ranked = liquipediaRows
      .map((row) => ({ row, score: [...eventNameTokens(row.name)].filter((token) => wantedTokens.has(token)).length }))
      .sort((a, b) => b.score - a.score);
    if (ranked[0]?.score > 0) return resultPageUrl(slug, ranked[0].row.url);
  }
  return resultPageUrl(slug, liquipediaRows[0].url);
}

// Narrow EWC team rows to the week game's OWN event. Fallback chain, most to
// least specific — each step only applies when it actually matches something:
//  1. Exact event path from the round's eventUrl. In practice the EWC calendar
//     links hub pages ("esports/Esports_World_Cup") that match no tracked
//     tournament, so this step usually falls through — it must NEVER zero the
//     list on its own (that would silently drop every real participant).
//  2. Fighters disambiguation: SF6 / Tekken / Fatal Fury share the `fighters`
//     slug, so match the game NAME's fighters tag against tournament names.
//  3. Everything EWC for the game (correct for every single-event game).
function scopeRows(rows, { slug, gameName, eventPath }) {
  if (eventPath) {
    const exact = rows.filter((row) => String(row.tournament_path ?? '').toLowerCase() === eventPath);
    if (exact.length) return exact;
  }
  if (normalizeGameSlug(slug) === 'fighters') {
    const wanted = fightersTag(gameName);
    const tagged = rows.filter((row) => fightersTag(row.tournament_name) === wanted);
    if (tagged.length) return tagged;
  }
  return rows;
}

// The teams actually participating in the tracked EWC event(s) for a game — the
// qualified field a weekly pick should choose from. Sourced from tournament
// STANDINGS (participants/qualifier tables, BR/TFT fields, group tables) plus,
// for head-to-head games, the tracked match team names — scoped to EWC
// tournaments, so teams from unrelated tracked events (e.g. LCK in LoL, regional
// R6 leagues) never become EWC pick options. When standings exist they are used
// ALONE: they are the curated field (e.g. a fighters participants table), while
// matches would add whole qualifier brackets (170+ LCQ entrants). Deduped by the
// same normalization scoring uses, so a picked name matches results at scoring.
/**
 * @param {string} gameName
 * @param {{ eventUrl?: string | null, eventName?: string | null, guildId?: string | null }} [options]
 */
export async function ewcGameParticipantTeams(gameName, { eventUrl = null, eventName = null, guildId = null } = {}) {
  const slug = slugForGameName(gameName);
  if (!slug) return [];
  const resolvedEventUrl = guildId
    ? await resolveEwcGameEventUrl(gameName, { guildId, eventUrl, eventName })
    : eventUrl;
  const eventPath = eventPathFromUrl(resolvedEventUrl);

  const [standingsRows, matchRows] = await Promise.all([
    listStandingsTeamRowsForGame(slug, { ewcOnly: true }).catch(() => []),
    isLobbyGame(slug) ? Promise.resolve([]) : listTrackedTeamRowsForGame(slug, { ewcOnly: true }).catch(() => []),
  ]);
  const standings = scopeRows(standingsRows, { slug, gameName, eventPath });
  const matchTeams = standings.length ? [] : scopeRows(matchRows, { slug, gameName, eventPath });

  const seen = new Set();
  const out = [];
  for (const row of [...standings, ...matchTeams]) {
    const clean = String(row.team ?? '').replace(/\s+/g, ' ').trim();
    if (!clean || looksLikeScheduleRow(clean)) continue;
    const key = normalizeClubName(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

// True when `pick` matches one of the game's participants (by scoring-normalized
// name); returns the canonical participant name so it stores exactly as Liquipedia
// spells it. Null when no participant matches (caller falls back to the club list).
export function matchParticipant(pick, participants) {
  const key = normalizeClubName(pick);
  if (!key) return null;
  return participants.find((team) => normalizeClubName(team) === key) || null;
}
