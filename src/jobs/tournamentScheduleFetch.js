import { logger } from '../lib/logger.js';
import {
  recordTournamentSyncFailure,
  recordTournamentSyncSuccess,
} from '../db/tournamentSyncHealth.js';
import { categorizeTournamentSyncError } from '../lib/tournamentSyncHealth.js';

const inFlightScheduleFetches = new Map();
const nowSec = () => Math.floor(Date.now() / 1000);

function tournamentKey(tournament) {
  return tournament?.id || `${tournament?.source || 'unknown'}:${tournament?.external_id || 'unknown'}`;
}

async function recordFailure(tournament, error, clock) {
  try {
    await recordTournamentSyncFailure({
      tournamentId: tournament.id,
      source: tournament.source,
      category: categorizeTournamentSyncError(error),
      at: clock(),
    });
  } catch (recordError) {
    logger.error(`[sync-health] unable to record failed schedule fetch for tournament #${tournament.id}: ${recordError.message}`);
  }
}

// Shared by the morning sweep and live poller. It owns only caller-level
// coalescing and durable health; each service keeps its own provider queue/rate policy.
export async function fetchTournamentSchedule(service, tournament, { clock = nowSec } = {}) {
  const key = tournamentKey(tournament);
  if (inFlightScheduleFetches.has(key)) return inFlightScheduleFetches.get(key);

  const promise = (async () => {
    let matches;
    try {
      matches = await service.fetchSchedule(tournament);
      if (!Array.isArray(matches)) {
        throw new TypeError('Invalid non-array schedule response.');
      }
    } catch (error) {
      await recordFailure(tournament, error, clock);
      throw error;
    }

    try {
      await recordTournamentSyncSuccess({
        tournamentId: tournament.id,
        source: tournament.source,
        itemCount: matches.length,
        at: clock(),
      });
    } catch (recordError) {
      // Observability must not turn a successful provider result into a failed
      // schedule sync; surface the write problem in bot logs only.
      logger.error(`[sync-health] unable to record successful schedule fetch for tournament #${tournament.id}: ${recordError.message}`);
    }
    return matches;
  })().finally(() => inFlightScheduleFetches.delete(key));

  inFlightScheduleFetches.set(key, promise);
  return promise;
}
