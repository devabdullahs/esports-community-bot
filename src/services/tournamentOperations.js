import {
  addTournament,
  archiveTournament as archiveTournamentRow,
  deactivateTournament as deactivateTournamentRow,
  getActiveTournamentGeneration,
  getTournamentById,
  isTournamentGenerationActive,
  reactivateTournament as reactivateTournamentRow,
  updateTournamentEwc,
  updateTournamentGame,
  updateTournamentName,
  withActiveTournamentGeneration,
} from '../db/tournaments.js';
import {
  deleteTournamentDuplicateMatches,
  deleteTournamentPlaceholderMatches,
  reconcileUntimedTournamentMatches,
  toMatchRow,
  upsertMatch,
} from '../db/matches.js';
import { upsertMatchDetails } from '../db/matchDetails.js';
import { replaceTournamentStandings } from '../db/tournamentStandings.js';
import {
  markTournamentDataKindUnsupported,
  recordTournamentSyncFailure,
  recordTournamentSyncSuccess,
} from '../db/tournamentSyncHealth.js';
import { ensureIndividualCompetitorProfiles } from '../db/players.js';
import { categorizeTournamentSyncError } from '../lib/tournamentSyncHealth.js';
import { isStandingsGame } from '../lib/tournamentStandingsSupport.js';
import { canonicalTournamentUrl, formatLiquipediaPageTitle } from '../lib/parseTournamentInput.js';
import { logger } from '../lib/logger.js';
import { fetchTournamentSchedule } from '../jobs/tournamentScheduleFetch.js';
import { tournamentProviderAdmissionOptions } from './tournamentProviderAdmission.js';
import * as liquipedia from './liquipedia.js';
import * as startgg from './startgg.js';
import * as pandascore from './pandascore.js';

const services = Object.freeze({ liquipedia, startgg, pandascore });

function operationError(code, message) {
  const error = new Error(message);
  error.reasonCode = code;
  return error;
}

function serviceFor(source) {
  const service = services[source];
  if (!service?.fetchSchedule) throw operationError('unsupported_source', `Unsupported tournament source: ${source}`);
  return service;
}

function validationCandidate(request) {
  const page = request.source === 'liquipedia' ? request.sourceId.split('/').slice(1).join('/') : '';
  return {
    id: null,
    source: request.source,
    external_id: request.sourceId,
    game: request.game,
    name:
      request.source === 'liquipedia'
        ? formatLiquipediaPageTitle(page)
        : request.source === 'startgg'
          ? request.sourceId.split('/').at(-1).replaceAll('-', ' ')
          : `PandaScore #${request.sourceId}`,
    url: canonicalTournamentUrl(request.source, request.sourceId),
    guild_id: request.guildId,
    added_by: request.requestedActorId,
    ewc: 0,
  };
}

async function resolveProviderMetadata(service, tournament, providerOptions = {}) {
  let next = { ...tournament };
  const invoke = (method) => {
    const dispatch = () => method(next, providerOptions);
    return providerOptions.beforeDispatch ? providerOptions.beforeDispatch(dispatch) : dispatch();
  };
  if (service.resolveTournamentTitle) {
    const name = await invoke(service.resolveTournamentTitle);
    if (name) next.name = String(name).trim().slice(0, 180);
  }
  if (!next.game && service.resolveTournamentGame) {
    const game = await invoke(service.resolveTournamentGame);
    if (game) next.game = game;
  }
  if (service.resolveTournamentEwc) {
    next.ewc = (await invoke(service.resolveTournamentEwc)) ? 1 : 0;
  }
  return next;
}

async function persistScheduleAtGeneration(tournament, generation, fetchedMatches, effects = {}) {
  const matches = await reconcileUntimedTournamentMatches(tournament.id, fetchedMatches);
  const persisted = await withActiveTournamentGeneration(tournament.id, generation, async (tx) => {
    const rows = [];
    for (const parsed of matches) {
      const row = await upsertMatch(toMatchRow(parsed, tournament.id), { client: tx });
      rows.push(row);
      if (parsed.details) {
        await upsertMatchDetails(
          {
            matchId: row.id,
            sourcePage: parsed.detailsSourcePage || parsed.externalId,
            game: tournament.game,
            payload: parsed.details,
          },
          { client: tx },
        );
      }
    }
    const currentIds = matches.map((match) => match.externalId);
    await deleteTournamentPlaceholderMatches(tournament.id, currentIds, { client: tx });
    await deleteTournamentDuplicateMatches(tournament.id, currentIds, { client: tx });
    return rows;
  });
  if (!persisted.applied) {
    await recordTournamentSyncFailure({
      tournamentId: tournament.id,
      source: tournament.source,
      category: 'stale_generation',
      dataKind: 'schedule',
    }).catch(() => {});
    throw operationError('stale_generation', 'Tournament lifecycle changed before schedule persistence.');
  }

  if (!(await isTournamentGenerationActive(tournament.id, generation))) {
    throw operationError('stale_generation', 'Tournament lifecycle changed before watcher registration.');
  }
  await ensureIndividualCompetitorProfiles(
    tournament.game,
    matches.flatMap((match) => [match.teamA, match.teamB]),
  );
  for (const row of persisted.value) effects.armMatch?.(row, { ...tournament, lifecycle_generation: generation });
  return persisted.value.length;
}

export async function validateAndActivateTournament(request, effects = {}) {
  const candidate = validationCandidate(request);
  const service = serviceFor(candidate.source);
  let resolved;
  let fetched;
  try {
    resolved = await resolveProviderMetadata(service, candidate);
    fetched = await service.fetchSchedule(resolved);
    if (!Array.isArray(fetched)) throw operationError('invalid_schedule', 'Provider returned an invalid schedule.');
  } catch (error) {
    if (!error.reasonCode) error.reasonCode = categorizeTournamentSyncError(error);
    throw error;
  }

  const tournament = await addTournament(resolved);
  const generation = Number(tournament.lifecycle_generation);
  await recordTournamentSyncSuccess({
    tournamentId: tournament.id,
    source: tournament.source,
    itemCount: fetched.length,
    dataKind: 'schedule',
  }).catch((error) => logger.warn(`[tournament-operations] schedule health #${tournament.id}: ${error.message}`));
  const count = await persistScheduleAtGeneration(tournament, generation, fetched, effects);
  await effects.refreshGuild?.(tournament.guild_id);
  return { code: 'validated_and_activated', tournamentId: tournament.id, count, generation };
}

async function activeTournamentForOperation(tournamentId, guildId) {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament || String(tournament.guild_id) !== String(guildId)) {
    throw operationError('tournament_not_found', 'Tournament not found.');
  }
  const lifecycle = await getActiveTournamentGeneration(tournamentId, guildId);
  if (!lifecycle) throw operationError('tournament_inactive', 'Tournament is not active.');
  return { tournament, generation: Number(lifecycle.lifecycle_generation) };
}

export async function syncTournamentSchedule(tournamentId, guildId, effects = {}) {
  let { tournament, generation } = await activeTournamentForOperation(tournamentId, guildId);
  const service = serviceFor(tournament.source);
  const providerOptions = tournamentProviderAdmissionOptions(tournament.id, generation);
  tournament = await resolveProviderMetadata(service, tournament, providerOptions);
  if (tournament.name) await updateTournamentName(tournament.id, tournament.name);
  if (tournament.game) await updateTournamentGame(tournament.id, tournament.game);
  await updateTournamentEwc(tournament.id, tournament.ewc);
  const fetched = await fetchTournamentSchedule(service, tournament, providerOptions);
  const count = await persistScheduleAtGeneration(tournament, generation, fetched, effects);
  await effects.refreshGuild?.(tournament.guild_id);
  return { code: 'schedule_synced', tournamentId: tournament.id, count, generation };
}

export async function syncTournamentStandings(
  tournamentId,
  guildId,
  { liquipediaService = liquipedia } = {},
) {
  const { tournament, generation } = await activeTournamentForOperation(tournamentId, guildId);
  if (tournament.source !== 'liquipedia' || !isStandingsGame(tournament.game)) {
    await markTournamentDataKindUnsupported({
      tournamentId,
      source: tournament.source,
      dataKind: 'standings',
    });
    return { code: 'standings_not_supported', tournamentId, count: 0, generation };
  }

  try {
    const providerOptions = tournamentProviderAdmissionOptions(tournament.id, generation);
    const dispatch = () => liquipediaService.fetchEventStandings(tournament, providerOptions);
    const { sections, hadRows } = await providerOptions.beforeDispatch(dispatch);
    if (!sections.length && !hadRows) {
      await recordTournamentSyncFailure({
        tournamentId,
        source: tournament.source,
        category: 'empty',
        dataKind: 'standings',
      });
      return { code: 'standings_empty', tournamentId, count: 0, generation, empty: true };
    }
    const persisted = await withActiveTournamentGeneration(tournamentId, generation, (tx) =>
      replaceTournamentStandings(tournamentId, sections, { client: tx }),
    );
    if (!persisted.applied) throw operationError('stale_generation', 'Tournament lifecycle changed before standings persistence.');
    await recordTournamentSyncSuccess({
      tournamentId,
      source: tournament.source,
      itemCount: persisted.value,
      dataKind: 'standings',
    });
    return { code: 'standings_synced', tournamentId, count: persisted.value, generation };
  } catch (error) {
    await recordTournamentSyncFailure({
      tournamentId,
      source: tournament.source,
      category: error.reasonCode || categorizeTournamentSyncError(error),
      dataKind: 'standings',
    }).catch(() => {});
    throw error;
  }
}

async function finishLifecycleOperation(tournamentId, guildId, operation, effects = {}) {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament || String(tournament.guild_id) !== String(guildId)) {
    throw operationError('tournament_not_found', 'Tournament not found.');
  }
  const row =
    operation === 'archive'
      ? await archiveTournamentRow(tournamentId, guildId)
      : await deactivateTournamentRow(tournamentId, guildId);
  effects.stopTournament?.(tournamentId);
  await effects.refreshGuild?.(guildId);
  return {
    code: operation === 'archive' ? 'archived' : 'deactivated',
    tournamentId,
    generation: Number(row?.lifecycle_generation ?? tournament.lifecycle_generation),
  };
}

export function archiveTournamentCompletely(tournamentId, guildId, effects = {}) {
  return finishLifecycleOperation(tournamentId, guildId, 'archive', effects);
}

export function deactivateTournamentCompletely(tournamentId, guildId, effects = {}) {
  return finishLifecycleOperation(tournamentId, guildId, 'deactivate', effects);
}

export async function reactivateTournamentCompletely(tournamentId, guildId, effects = {}) {
  const stored = await getTournamentById(tournamentId);
  if (!stored || String(stored.guild_id) !== String(guildId)) {
    throw operationError('tournament_not_found', 'Tournament not found.');
  }
  const service = serviceFor(stored.source);
  const resolved = await resolveProviderMetadata(service, stored);
  const fetched = await service.fetchSchedule(resolved);
  if (!Array.isArray(fetched)) throw operationError('invalid_schedule', 'Provider returned an invalid schedule.');
  const tournament = await reactivateTournamentRow(tournamentId, guildId);
  if (!tournament) throw operationError('already_active', 'Tournament is already active.');
  const generation = Number(tournament.lifecycle_generation);
  if (resolved.name) await updateTournamentName(tournament.id, resolved.name);
  if (resolved.game) await updateTournamentGame(tournament.id, resolved.game);
  await updateTournamentEwc(tournament.id, resolved.ewc);
  const count = await persistScheduleAtGeneration({ ...tournament, ...resolved, id: tournament.id }, generation, fetched, effects);
  await effects.refreshGuild?.(guildId);
  return { code: 'reactivated', tournamentId, count, generation };
}

export async function runTournamentOperation(operation, effects = {}) {
  switch (operation.operation) {
    case 'validate_and_activate':
      return validateAndActivateTournament(operation, effects);
    case 'sync_schedule':
      return syncTournamentSchedule(operation.tournamentId, operation.guildId, effects);
    case 'sync_standings':
      return syncTournamentStandings(operation.tournamentId, operation.guildId);
    case 'archive':
      return archiveTournamentCompletely(operation.tournamentId, operation.guildId, effects);
    case 'deactivate':
      return deactivateTournamentCompletely(operation.tournamentId, operation.guildId, effects);
    case 'reactivate':
      return reactivateTournamentCompletely(operation.tournamentId, operation.guildId, effects);
    default:
      throw operationError('unsupported_operation', 'Unsupported tournament operation.');
  }
}
