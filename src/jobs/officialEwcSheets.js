import { createHash } from 'node:crypto';
import { config } from '../config.js';
import {
  contentHash,
  getOfficialFeedState,
  opaqueWorkbookKey,
  saveOfficialFeedState,
  upsertOfficialTournamentOverview,
} from '../db/officialEwcSheets.js';
import { listMatchesForTournament, upsertMatch } from '../db/matches.js';
import { upsertMatchDetails } from '../db/matchDetails.js';
import { replaceTournamentStandings } from '../db/tournamentStandings.js';
import { listActiveTournaments } from '../db/tournaments.js';
import { isEwcTournamentReference } from '../lib/ewcTournament.js';
import { logger } from '../lib/logger.js';
import { normalizeTeamName } from '../lib/render.js';
import { createOfficialSheetsClient } from '../services/officialEwcSheets/client.js';
import {
  parseOfficialWorkbook,
  workbookDescriptor,
} from '../services/officialEwcSheets/parsers.js';

const MATCH_TIME_WINDOW_SECONDS = 15 * 60;
const ATTRIBUTION = '© Esports Foundation 2026. All rights reserved.';
const DETAIL_SOURCE = 'internal-normalized';

let running = false;
let client = null;
let lastScanSummary = null;

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

export function normalizedOfficialPair(teamA, teamB) {
  return [normalizeTeamName(teamA), normalizeTeamName(teamB)].sort().join('|');
}

export function resolveOfficialTournament(tournaments, descriptor) {
  const candidates = (tournaments || []).filter(
    (tournament) =>
      tournament?.active === 1 &&
      tournament?.archived_at == null &&
      tournament?.game === descriptor?.game &&
      isEwcTournamentReference(tournament),
  );
  const needle = normalized(descriptor?.tournamentNeedle);
  const narrowed = needle
    ? candidates.filter((tournament) =>
        normalized(`${tournament.name || ''} ${tournament.external_id || ''} ${tournament.url || ''}`).includes(
          needle,
        ),
      )
    : candidates;
  return narrowed.length === 1 ? narrowed[0] : null;
}

export function findOfficialMatch(matches, update) {
  const pair = normalizedOfficialPair(update?.teamA, update?.teamB);
  if (!pair || pair === '|') return null;
  const candidates = (matches || []).filter(
    (match) => normalizedOfficialPair(match.team_a, match.team_b) === pair,
  );
  const scheduledAt = Number(update?.scheduledAt);
  if (Number.isFinite(scheduledAt) && scheduledAt > 0) {
    const timed = candidates.filter((match) => {
      const stored = Number(match.scheduled_at);
      return Number.isFinite(stored) && Math.abs(stored - scheduledAt) <= MATCH_TIME_WINDOW_SECONDS;
    });
    return timed.length === 1 ? timed[0] : null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function publicExternalId(tournament, update) {
  const logical = [
    tournament.id,
    normalizedOfficialPair(update.teamA, update.teamB),
    update.scheduledAt || 'untimed',
    normalized(update.round || update.name),
  ].join('|');
  return `official:${createHash('sha256').update(logical).digest('hex').slice(0, 32)}`;
}

function rowFromUpdate(tournament, existing, update) {
  return {
    tournament_id: tournament.id,
    source: existing?.source || tournament.source,
    external_id: existing?.external_id || publicExternalId(tournament, update),
    name: update.name || existing?.name || `${update.teamA} vs ${update.teamB}`,
    team_a: update.teamA || existing?.team_a || 'TBD',
    team_b: update.teamB || existing?.team_b || 'TBD',
    logo_a: existing?.logo_a || null,
    logo_b: existing?.logo_b || null,
    score_a: update.scoreA ?? existing?.score_a ?? null,
    score_b: update.scoreB ?? existing?.score_b ?? null,
    status: update.status || existing?.status || 'scheduled',
    scheduled_at: update.scheduledAt ?? existing?.scheduled_at ?? null,
    stream_platform: existing?.stream_platform || null,
    stream_url: existing?.stream_url || null,
  };
}

function authorityFields(update) {
  const fields = [];
  if (update.name) fields.push('name');
  if (update.teamA) fields.push('team_a');
  if (update.teamB) fields.push('team_b');
  if (update.scoreA !== null && update.scoreA !== undefined) fields.push('score_a');
  if (update.scoreB !== null && update.scoreB !== undefined) fields.push('score_b');
  if (update.status) fields.push('status');
  if (update.scheduledAt !== null && update.scheduledAt !== undefined) fields.push('scheduled_at');
  return fields;
}

function matchDetailsBase(kind) {
  return { version: 1, kind, patch: null, casters: [], attribution: ATTRIBUTION };
}

async function applyMatchUpdate(tournament, matches, update, observedAt, ttlSeconds) {
  const existing = findOfficialMatch(matches, update);
  const stored = await upsertMatch(rowFromUpdate(tournament, existing, update), {
    authoritative: true,
    authorityTtlSeconds: ttlSeconds,
    observedAt,
    authorityFields: authorityFields(update),
  });
  if (!existing) matches.push(stored);
  else Object.assign(existing, stored);
  return stored;
}

function detailMatchByLabel(matches, label) {
  const key = normalized(label);
  if (!key) return null;
  const candidates = matches.filter((match) => {
    const values = [match.name, match.team_a, match.team_b].map(normalized);
    return values.some((value) => value === key || value.includes(key) || key.includes(value));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function applyDetails(tournament, matches, parsed) {
  for (const result of parsed.individualResults) {
    const match = findOfficialMatch(matches, result);
    if (!match) continue;
    await upsertMatchDetails({
      matchId: match.id,
      sourcePage: DETAIL_SOURCE,
      game: tournament.game,
      payload: {
        ...matchDetailsBase('individual'),
        round: result.round || null,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        penaltyA: result.penaltyA,
        penaltyB: result.penaltyB,
      },
    });
  }

  // Keyed by pair AND series: the same two teams can meet twice in one event (group
  // stage then playoffs), and merging those would file one series' maps under the other.
  const mapsBySeries = new Map();
  for (const map of parsed.mapDetails) {
    const key = `${normalizedOfficialPair(map.teamA, map.teamB)}#${normalized(map.round)}`;
    const bucket = mapsBySeries.get(key) || [];
    bucket.push(map);
    mapsBySeries.set(key, bucket);
  }
  for (const maps of mapsBySeries.values()) {
    const first = maps[0];
    const match = findOfficialMatch(matches, first);
    if (!match) continue;
    await upsertMatchDetails({
      matchId: match.id,
      sourcePage: DETAIL_SOURCE,
      game: tournament.game,
      payload: {
        ...matchDetailsBase('teamSeries'),
        maps: maps.map((map) => ({
          name: map.map || null,
          mode: map.mode || null,
          round: map.round || null,
          pickedBy: map.pickedBy || null,
          scoreA: map.scoreA,
          scoreB: map.scoreB,
          winner: map.winner || null,
          bans: map.banA || map.banB
            ? {
                a: map.banA ? { hero: map.banA, order: map.banOrderA ?? null } : null,
                b: map.banB ? { hero: map.banB, order: map.banOrderB ?? null } : null,
              }
            : null,
        })),
      },
    });
  }

  for (const game of parsed.battleRoyaleGames) {
    const match = detailMatchByLabel(matches, game.label);
    if (!match) continue;
    await upsertMatchDetails({
      matchId: match.id,
      sourcePage: DETAIL_SOURCE,
      game: tournament.game,
      payload: {
        ...matchDetailsBase('battleRoyale'),
        gameLabel: game.label,
        standings: game.standings,
      },
    });
  }
}

async function refreshWorkbook(workbook, tournaments, sheetsClient) {
  const descriptor = workbookDescriptor(workbook.name);
  if (!descriptor) return { changed: false, reason: 'unsupported' };
  const tournament = resolveOfficialTournament(tournaments, descriptor);
  if (!tournament) return { changed: false, reason: 'unresolved' };

  const workbookKey = opaqueWorkbookKey(workbook.id);
  const modifiedToken = contentHash(String(workbook.modifiedTime || ''));
  const previous = await getOfficialFeedState(workbookKey);
  if (previous?.modified_token === modifiedToken) return { changed: false, reason: 'unchanged' };

  const tabs = await sheetsClient.readWorkbook(workbook.id);
  const parsed = parseOfficialWorkbook(workbook.name, tabs);
  if (!parsed) return { changed: false, reason: 'unsupported' };
  const hash = contentHash(parsed);
  if (previous?.content_hash === hash) {
    await saveOfficialFeedState({
      workbookKey,
      modifiedToken,
      hash,
      observedAt: Math.floor(Date.now() / 1000),
    });
    return { changed: false, reason: 'unchanged' };
  }

  const observedAt = Math.floor(Date.now() / 1000);
  const ttlSeconds = config.officialEwcSheets.authorityTtlSeconds;
  const matches = await listMatchesForTournament(tournament.id);
  for (const update of [...parsed.schedule, ...parsed.individualResults.map((result) => ({
    ...result,
    name: `${result.teamA} vs ${result.teamB}`,
    status: 'finished',
    scheduledAt: null,
  }))]) {
    await applyMatchUpdate(tournament, matches, update, observedAt, ttlSeconds);
  }

  if (parsed.standings.some((section) => section.entries?.length >= 2)) {
    await replaceTournamentStandings(tournament.id, parsed.standings, {
      authoritative: true,
      observedAt,
      authorityTtlSeconds: ttlSeconds,
    });
  }

  await applyDetails(tournament, matches, parsed);
  await upsertOfficialTournamentOverview(
    tournament.id,
    { ...parsed.overview, attribution: ATTRIBUTION },
    { observedAt, ttlSeconds },
  );
  await saveOfficialFeedState({ workbookKey, modifiedToken, hash, observedAt });
  return {
    changed: true,
    game: tournament.game,
    matches: parsed.schedule.length + parsed.individualResults.length,
    standings: parsed.standings.reduce((sum, section) => sum + section.entries.length, 0),
  };
}

export async function refreshOfficialEwcSheets() {
  if (!config.officialEwcSheets.enabled || running) return;
  running = true;
  try {
    client ||= createOfficialSheetsClient({
      clientEmail: config.officialEwcSheets.clientEmail,
      privateKey: config.officialEwcSheets.privateKey,
    });
    const [workbooks, tournaments] = await Promise.all([
      client.listWorkbooks(config.officialEwcSheets.folderId),
      listActiveTournaments(),
    ]);
    let changed = 0;
    const reasons = new Map();
    for (const workbook of workbooks) {
      try {
        const result = await refreshWorkbook(workbook, tournaments, client);
        reasons.set(result.reason || 'refreshed', (reasons.get(result.reason || 'refreshed') || 0) + 1);
        if (result.changed) {
          changed += 1;
          logger.info(
            `[tournament-feed] refreshed ${result.game}: ${result.matches} matches, ${result.standings} standings rows`,
          );
        }
      } catch {
        reasons.set('failed', (reasons.get('failed') || 0) + 1);
        logger.warn('[tournament-feed] workbook refresh failed');
      }
    }
    if (changed) logger.info(`[tournament-feed] refresh completed for ${changed} tournament(s)`);
    const summary = [
      `workbooks=${workbooks.length}`,
      `refreshed=${changed}`,
      `unchanged=${reasons.get('unchanged') || 0}`,
      `unresolved=${reasons.get('unresolved') || 0}`,
      `unsupported=${reasons.get('unsupported') || 0}`,
      `failed=${reasons.get('failed') || 0}`,
    ].join(' ');
    if (summary !== lastScanSummary) {
      logger.info(`[tournament-feed] scan completed: ${summary}`);
      lastScanSummary = summary;
    }
  } catch {
    logger.warn('[tournament-feed] refresh failed');
  } finally {
    running = false;
  }
}

export function startOfficialEwcSheets() {
  if (!config.officialEwcSheets.enabled) return null;
  if (
    !config.officialEwcSheets.folderId ||
    !config.officialEwcSheets.clientEmail ||
    !config.officialEwcSheets.privateKey
  ) {
    logger.warn('[tournament-feed] enabled but credentials are incomplete');
    return null;
  }
  const boot = setTimeout(
    () => refreshOfficialEwcSheets(),
    config.officialEwcSheets.bootDelayMs,
  );
  boot.unref?.();
  const interval = setInterval(
    () => refreshOfficialEwcSheets(),
    config.officialEwcSheets.pollMs,
  );
  interval.unref?.();
  return interval;
}

export const officialTournamentAttribution = ATTRIBUTION;
