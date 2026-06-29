import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { normalizeGameSlug } from '../lib/games.js';

// PandaScore REST API (the free tier serves match, team, and player data).
// Docs: https://developers.pandascore.co/reference
const client = axios.create({
  baseURL: config.pandascore.baseUrl,
  timeout: 15_000,
  headers: config.pandascore.token ? { Authorization: `Bearer ${config.pandascore.token}` } : {},
});

const PANDASCORE_GAME_PATHS = {
  counterstrike: 'csgo',
  csgo: 'csgo',
  cs2: 'csgo',
  dota2: 'dota2',
  leagueoflegends: 'lol',
  lol: 'lol',
  valorant: 'valorant',
  overwatch: 'ow',
  rocketleague: 'rl',
  rainbowsix: 'r6siege',
  easportsfc: 'fifa',
};

let queue = Promise.resolve();
let pausedUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function queuedGet(path, options = {}) {
  const run = async () => {
    const waitForBackoff = pausedUntil - Date.now();
    if (waitForBackoff > 0) await sleep(waitForBackoff);
    await sleep(config.pandascore.profilesMinGapMs);
    try {
      return await client.get(path, options);
    } catch (error) {
      if (error.response?.status === 429) {
        pausedUntil = Date.now() + config.pandascore.profilesBackoffMs;
        logger.warn(
          `[pandascore] rate limited (HTTP 429) - pausing requests for ${Math.round(
            config.pandascore.profilesBackoffMs / 60_000,
          )} min`,
        );
      }
      throw error;
    }
  };

  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

export function hasPandaScoreToken() {
  return Boolean(config.pandascore.token);
}

export function canonicalPandaScoreGame(game) {
  const slug = normalizeGameSlug(String(game || '').trim().toLowerCase());
  return PANDASCORE_GAME_PATHS[slug] ? slug : null;
}

export function pandascoreGamePath(game) {
  const slug = normalizeGameSlug(String(game || '').trim().toLowerCase());
  return PANDASCORE_GAME_PATHS[slug] ?? null;
}

async function fetchPaginated(path, { pageLimit = config.pandascore.profilesMaxPages, params = {} } = {}) {
  const rows = [];
  for (let page = 1; page <= pageLimit; page += 1) {
    const { data } = await queuedGet(path, {
      params: {
        per_page: config.pandascore.profilesPerPage,
        page,
        ...params,
      },
    });
    if (!Array.isArray(data) || !data.length) break;
    rows.push(...data);
    if (data.length < config.pandascore.profilesPerPage) break;
  }
  return rows;
}

// Normalize a PandaScore match object into the bot's standard match shape.
export function normalizeMatch(m) {
  const [a, b] = m.opponents ?? [];
  const idA = a?.opponent?.id;
  const idB = b?.opponent?.id;
  const results = m.results ?? [];
  const scoreOf = (id) => {
    const r = results.find((x) => x.team_id === id || x.player_id === id || x.id === id);
    return r && r.score != null ? Number(r.score) : null;
  };
  const teamA = a?.opponent?.name ?? 'TBD';
  const teamB = b?.opponent?.name ?? 'TBD';
  const winnerId = m.winner_id;
  return {
    source: 'pandascore',
    externalId: String(m.id),
    name: m.name || `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    logoA: a?.opponent?.image_url ?? null,
    logoB: b?.opponent?.image_url ?? null,
    scoreA: scoreOf(idA),
    scoreB: scoreOf(idB),
    bestOf: m.number_of_games ?? null,
    scheduledAt: m.begin_at ? Math.floor(new Date(m.begin_at).getTime() / 1000) : null,
    status: m.status === 'running' ? 'running' : m.status === 'finished' ? 'finished' : 'scheduled',
    winner: winnerId ? (winnerId === idA ? teamA : winnerId === idB ? teamB : null) : null,
  };
}

// Matches for a tracked PandaScore id (external_id may be a tournament id or a serie id).
export async function fetchSchedule(tournament) {
  if (!config.pandascore.token) {
    logger.warn('[pandascore] PANDASCORE_TOKEN not set - skipping.');
    return [];
  }
  const id = encodeURIComponent(tournament.external_id);
  for (const path of [`/tournaments/${id}/matches`, `/series/${id}/matches`]) {
    try {
      const { data } = await queuedGet(path, { params: { per_page: 50, sort: 'begin_at' } });
      if (Array.isArray(data) && data.length) {
        return data.map(normalizeMatch).filter((m) => m.teamA !== 'TBD' || m.teamB !== 'TBD');
      }
    } catch (e) {
      if (e.response?.status && e.response.status !== 404) {
        logger.warn(`[pandascore] ${path}: HTTP ${e.response.status}`);
      }
    }
  }
  return [];
}

export function normalizeTeamProfile(team, game) {
  return {
    game,
    pandascore_id: numberOrNull(team?.id),
    name: textOrNull(team?.name) ?? textOrNull(team?.acronym) ?? `Team ${team?.id}`,
    slug: textOrNull(team?.slug),
    acronym: textOrNull(team?.acronym),
    nationality: textOrNull(team?.nationality),
    image_url: textOrNull(team?.image_url),
    location: textOrNull(team?.location),
    modified_at: textOrNull(team?.modified_at),
    raw_json: team ?? null,
  };
}

export function normalizePlayerProfile(player, game, teamByPandaScoreId = new Map()) {
  const currentTeam = player?.current_team ?? player?.team ?? null;
  const currentTeamPandaScoreId = numberOrNull(currentTeam?.id ?? player?.current_team_id ?? player?.team_id);
  const resolvedTeam = currentTeamPandaScoreId ? teamByPandaScoreId.get(currentTeamPandaScoreId) : null;
  return {
    game,
    pandascore_id: numberOrNull(player?.id),
    name: textOrNull(player?.name) ?? textOrNull(player?.slug) ?? `Player ${player?.id}`,
    slug: textOrNull(player?.slug),
    first_name: textOrNull(player?.first_name),
    last_name: textOrNull(player?.last_name),
    nationality: textOrNull(player?.nationality),
    image_url: textOrNull(player?.image_url),
    role: textOrNull(player?.role),
    current_team_id: resolvedTeam?.id ?? null,
    current_team_pandascore_id: currentTeamPandaScoreId,
    current_team_name: textOrNull(currentTeam?.name),
    modified_at: textOrNull(player?.modified_at),
    raw_json: player ?? null,
  };
}

export async function fetchTeamsForGame(game, options = {}) {
  if (!config.pandascore.token) throw new Error('PANDASCORE_TOKEN is not configured.');
  const gamePath = pandascoreGamePath(game);
  if (!gamePath) return [];
  const rows = await fetchPaginated(`/${gamePath}/teams`, options);
  const canonical = canonicalPandaScoreGame(game) ?? normalizeGameSlug(game);
  return rows.map((row) => normalizeTeamProfile(row, canonical)).filter((row) => row.pandascore_id && row.name);
}

export async function fetchPlayersForGame(game, teamByPandaScoreId = new Map(), options = {}) {
  if (!config.pandascore.token) throw new Error('PANDASCORE_TOKEN is not configured.');
  const gamePath = pandascoreGamePath(game);
  if (!gamePath) return [];
  const rows = await fetchPaginated(`/${gamePath}/players`, options);
  const canonical = canonicalPandaScoreGame(game) ?? normalizeGameSlug(game);
  return rows
    .map((row) => normalizePlayerProfile(row, canonical, teamByPandaScoreId))
    .filter((row) => row.pandascore_id && row.name);
}

export { client as pandascoreClient };
