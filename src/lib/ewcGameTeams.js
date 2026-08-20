import { categoryToGameSlug, fightersTag, gameSlugFromName, isLobbyGame, isKnownGameSlug, normalizeGameSlug } from './games.js';
import { EWC_POINTS_BY_RANK, ewcPlacementCoveredRanks, normalizeClubName } from './ewcPredictions.js';
import { normalizeTeamName } from './render.js';
import { logger } from './logger.js';
import { listStandingsForTournament, listStandingsTeamRowsForGame } from '../db/tournamentStandings.js';
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
    const url = new URL(String(eventUrl).replace(/^url:/i, ''));
    if (!/liquipedia\.net$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0].toLowerCase()}/${parts.slice(1).join('/')}`.toLowerCase();
  } catch {
    return null;
  }
}

function finalStandingsPriority(section) {
  const normalized = String(section || '').trim().toLowerCase().replace(/\bfinals\b/g, 'final');
  if (/\bgrand final\b/.test(normalized)) return 4;
  if (/\bfinal standings\b/.test(normalized)) return 3;
  if (/(?:^|:)\s*final\s*$/.test(normalized)) return 1;
  return 0;
}

function trackedTournamentForEvent(rows, { slug, gameName, eventUrl, eventName }) {
  const liquipediaRows = rows.filter((row) => row.source === 'liquipedia' && eventPathFromUrl(row.url));
  if (!liquipediaRows.length) return null;

  const requestedPath = eventPathFromUrl(eventUrl);
  const exact = requestedPath
    ? liquipediaRows.find((row) => eventPathFromUrl(row.url) === requestedPath)
    : null;
  if (exact) return exact;

  if (normalizeGameSlug(slug) === 'fighters') {
    const wanted = fightersTag(gameName);
    const tagged = liquipediaRows.find((row) => fightersTag(row.name) === wanted);
    if (tagged) return tagged;
  }

  const wantedTokens = eventNameTokens(eventName);
  if (wantedTokens.size) {
    const ranked = liquipediaRows
      .map((row) => ({ row, score: [...eventNameTokens(row.name)].filter((token) => wantedTokens.has(token)).length }))
      .sort((a, b) => b.score - a.score);
    // A single shared word is not the same event. "MLBB Women's International" and "MLBB Mid
    // Season Cup" overlap on "mlbb" alone, and taking that as a match is how week 2 came to be
    // graded against the wrong tournament. Require most of the requested name to agree.
    if (ranked[0] && ranked[0].score * 2 >= wantedTokens.size) return ranked[0].row;
  }

  // Falling through to "any tournament for this game" scores a week against the wrong event.
  // MLBB Women's International is archived, so only the Mid Season Cup was listed, and week 2
  // graded its picks on that: Team Falcons took 4th place and 300 points it never won there,
  // while the actual winner matched nothing. Nothing said so.
  //
  // A request that NAMES an event and matches none of them has to come back empty; the caller
  // then falls back to the event's own URL, which at least addresses the right tournament. A
  // request with no name to go on — a generic calendar link, say — may still take the single
  // candidate, since there is nothing to contradict it.
  if (wantedTokens.size) return null;
  return liquipediaRows.length === 1 ? liquipediaRows[0] : null;
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
  const tournament = trackedTournamentForEvent(rows, { slug, gameName, eventUrl, eventName });
  return tournament ? resultPageUrl(slug, String(tournament.url).replace(/^url:/i, '')) : eventUrl;
}

// Prize tables can remain TBD after an event is complete even though the
// tracked page has already published an authoritative final standings table.
// This fallback deliberately accepts only semantically final sections and
// requires a first-place row; group-stage and live standings fail closed.
// Player id -> EWC club, from the official EWC player list. Solo-game standings rows carry
// a player name where team games carry a club, so without this the fallback would score
// club picks as misses. Mirrors the prize-table mapping in the Liquipedia parsers.
// A standings row names a player the way the event prints it ("Magnus Carlsen"); the player
// list carries the wiki id, which is often the same name without the space. normalizeClubName
// only lowercases and collapses whitespace, so those two never met and the player went
// unmapped — the club then took whichever of its OTHER players did map, silently scoring a
// worse placement than the one it actually earned. Index both forms.
function playerNameKeys(name) {
  return [...new Set([normalizeClubName(name), normalizeTeamName(name)].filter(Boolean))];
}

function playerClubLookup(players) {
  const byPlayer = new Map();
  for (const player of players || []) {
    if (!player?.id || !player.team || player.team === 'TBD') continue;
    const gameKey = normalizeClubName(player.game);
    for (const key of playerNameKeys(player.id)) {
      // Game-scoped keys win outright; the bare key keeps the first claim so two games
      // fielding the same handle cannot overwrite each other.
      byPlayer.set(`${gameKey}:${key}`, player.team);
      if (!byPlayer.has(key)) byPlayer.set(key, player.team);
    }
  }
  return byPlayer;
}

// A knockout prints tied finishers as one repeated rank — chess ends 1, 2, 3, 4, 5, 5, 5, 5 —
// but four players sharing 5th occupy 5th through 8th, and EWC pays all eight positions.
// Storing the bare rank made those rows cover only rank 5, so the result could never satisfy
// the "every awarded rank is covered" completeness rule and the week never finalised: the
// games were re-fetched every pass forever while their points went undistributed. A battle
// royale ranks 1..16 with no ties, which is why only the bracket games stalled.
//
// The span is clamped to the last paying rank: a five-way tie for 5th reaches 9th, and a rank
// nobody is paid for must not appear in a coverage range that only describes paid positions.
function tiedPlaceLabels(sectionRows) {
  const lastPaidRank = Math.max(...EWC_POINTS_BY_RANK.keys());
  const sharedAtRank = new Map();
  for (const row of sectionRows) {
    const rank = Number(row?.rank);
    if (!Number.isFinite(rank)) continue;
    if (!String(row?.team || '').trim()) continue;
    sharedAtRank.set(rank, (sharedAtRank.get(rank) || 0) + 1);
  }
  return (rank) => {
    const end = Math.min(rank + (sharedAtRank.get(rank) || 1) - 1, lastPaidRank);
    return end > rank ? `${rank}-${end}` : String(rank);
  };
}

function lookupOne(lookup, gameKey, name) {
  for (const key of playerNameKeys(name)) {
    const scoped = lookup.get(`${gameKey}:${key}`);
    if (scoped) return scoped;
  }
  for (const key of playerNameKeys(name)) {
    const bare = lookup.get(key);
    if (bare) return bare;
  }
  return null;
}

function clubForEntrant(lookup, gameName, entrant) {
  const gameKey = normalizeClubName(gameName);
  const whole = lookupOne(lookup, gameKey, entrant);
  if (whole) return whole;

  // A duo enters as one row — Fortnite's Reload Elite standings read "Goofy / ZDog" — so the
  // entrant is two people and matches no single player id. Resolve each side instead.
  const parts = entrant.split(/\s*[/&+]\s*|\s+,\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const clubs = new Set();
  for (const part of parts) {
    const club = lookupOne(lookup, gameKey, part);
    if (club) clubs.add(club);
  }
  // Both sides must agree. A duo drawn from two different clubs has no single owner, and
  // guessing one would hand another club's placement to whichever half resolved first.
  return clubs.size === 1 ? [...clubs][0] : null;
}

export async function trackedEwcGamePlacements(gameName, { guildId, eventUrl = null, eventName = null, players = [] } = {}) {
  const slug = slugForGameName(gameName);
  if (!slug || !guildId) return [];
  const tournaments = await listEwcTournamentsForGame(guildId, slug).catch(() => []);
  const tournament = trackedTournamentForEvent(tournaments, { slug, gameName, eventUrl, eventName });
  if (!tournament) return [];

  const rows = await listStandingsForTournament(tournament.id).catch(() => []);
  const sections = [...new Set(rows.map((row) => String(row.section || '').trim()).filter(Boolean))];
  const selected = sections
    .map((section, index) => ({ section, index, priority: finalStandingsPriority(section) }))
    .filter(({ priority }) => priority > 0)
    .sort((a, b) => b.priority - a.priority || b.index - a.index)[0]?.section;
  if (!selected) return [];

  const lookup = playerClubLookup(players);
  const placements = [];
  const byKey = new Map();
  const unmappedEntrants = [];
  const sectionRows = rows.filter((row) => row.section === selected);
  const placeLabel = tiedPlaceLabels(sectionRows);
  for (const row of sectionRows) {
    const rank = Number(row.rank);
    const points = EWC_POINTS_BY_RANK.get(rank) || 0;
    const entrant = String(row.team || '').replace(/\s+/g, ' ').trim();
    // Keep entrants who finished outside the paying ranks. Dropping them made a pick that
    // simply placed 17th indistinguishable from one the system could not resolve: the card
    // read "No matching result", which looks like a failure rather than a real, if
    // unrewarded, finish. They carry 0 points and no awarded rank, so they add nothing to
    // coverage and cannot change a score — only what the member is told.
    if (!entrant) continue;
    // Solo games: the standings row names a player, so score it as their club — the same
    // unit weekly picks are graded on. Team games fall through unchanged.
    const mapped = clubForEntrant(lookup, gameName, entrant);
    if (!mapped && lookup.size) unmappedEntrants.push(`${rank}. ${entrant}`);
    const club = mapped || entrant;
    const participant = mapped ? entrant : null;
    const key = normalizeClubName(club);
    const existing = byKey.get(key);
    if (existing) {
      // A club's best placement already counted; keep the other player as an alias so a
      // prediction naming them still resolves to this result.
      if (participant && !existing.participants?.includes(participant)) existing.participants.push(participant);
      continue;
    }
    const placement = { club, place: placeLabel(rank), points, participant };
    if (participant) placement.participants = [participant];
    byKey.set(key, placement);
    placements.push(placement);
  }
  // A solo entrant we could not resolve to a club is scored as if the player WERE the club,
  // so a club pick silently misses it and lands on a worse-placed team-mate instead. That is
  // a wrong score, not a missing one, so say it out loud rather than letting it pass.
  if (unmappedEntrants.length) {
    logger.warn(
      `[ewc] ${gameName}: ${unmappedEntrants.length} scoring entrant(s) not resolved to a club ` +
        `(${unmappedEntrants.slice(0, 5).join(', ')}) — club picks for them cannot score correctly`,
    );
  }
  if (!placements.some((row) => row.points === EWC_POINTS_BY_RANK.get(1))) return [];
  placements.sort((a, b) => b.points - a.points || a.club.localeCompare(b.club));

  // Which ranks the EVENT awarded, taken from the standings themselves rather than from the
  // club-deduplicated placements. A club keeps only its best finish, so when one club holds
  // two positions the lower row is dropped — chess's 4th-placed player shares a club with a
  // top-three finisher, and rank 4 vanished from the coverage even though the event plainly
  // awarded it. The week then reported missing_rank forever and never paid out.
  // Non-enumerable: this rides along with the placements without becoming one of them, so
  // callers that compare or serialize the list see exactly the rows they expect.
  return Object.defineProperty(placements, 'coveredRanks', {
    value: [
      ...new Set(sectionRows.flatMap((row) => ewcPlacementCoveredRanks(placeLabel(Number(row.rank))))),
    ].sort((a, b) => a - b),
    enumerable: false,
  });
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
