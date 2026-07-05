import { gameSlugFromName, isLobbyGame, isKnownGameSlug, normalizeGameSlug } from './games.js';
import { normalizeClubName } from './ewcPredictions.js';
import { listStandingsTeamNamesForGame } from '../db/tournamentStandings.js';
import { listTrackedTeamNamesForGame } from '../db/matches.js';

// Junk rows the BR/lobby schedule parser stores in `matches` (team_a = "Group A -
// Game 3", team_b = "Lobby", "… - Match"). These are never real teams, so keep them
// out of the weekly-pick option list. Standings rows are already clean participants.
function looksLikeScheduleRow(name) {
  return /\bgame\s*\d+\b/i.test(name) || /\bmatch$/i.test(name) || /^lobby$/i.test(name);
}

// Resolve a week's game NAME ("Free Fire", "Teamfight Tactics") to our game slug.
function slugForGameName(gameName) {
  const raw = String(gameName ?? '').trim();
  if (!raw) return null;
  const slug = gameSlugFromName(raw) || normalizeGameSlug(raw.toLowerCase());
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

// The teams actually participating in the tracked EWC event(s) for a game — the
// qualified field a weekly pick should choose from. Sourced from tournament
// STANDINGS (clean participant list for BR/TFT and group-stage tables) plus, for
// head-to-head games, the tracked match team names — scoped to EWC tournaments
// only, so teams from unrelated tracked events (e.g. LCK in LoL, regional R6
// leagues) never become EWC pick options. This is the authoritative per-game
// field: e.g. Free Fire's EVOS Divine lives here even though it is not an EWC Club
// Championship member. Deduped by the same normalization scoring uses, so a picked
// name here matches the Liquipedia results at scoring time.
export async function ewcGameParticipantTeams(gameName, { eventUrl = null } = {}) {
  const slug = slugForGameName(gameName);
  if (!slug) return [];
  const eventPath = eventPathFromUrl(eventUrl);

  const [standings, matchTeams] = await Promise.all([
    listStandingsTeamNamesForGame(slug, { ewcOnly: true, eventPath }).catch(() => []),
    isLobbyGame(slug) ? Promise.resolve([]) : listTrackedTeamNamesForGame(slug, { ewcOnly: true, eventPath }).catch(() => []),
  ]);

  const seen = new Set();
  const out = [];
  for (const name of [...standings, ...matchTeams]) {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
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
