import {
  claimNextTournamentOperation,
  completeTournamentOperation,
  failTournamentOperation,
  requeueTournamentOperation,
} from '../db/tournamentOperations.js';
import { recordAdminAudit } from '../db/ewcAdminAuditLog.js';
import { categorizeTournamentSyncError } from '../lib/tournamentSyncHealth.js';
import { logger } from '../lib/logger.js';
import { runTournamentOperation } from '../services/tournamentOperations.js';
import { armMatch, stopTournament } from './pollingManager.js';
import { refreshGuild } from './refresh.js';

const POLL_MS = 15_000;
const LEASE_SECONDS = 900;
const RETRYABLE_FAILURES = new Set(['rate_limit', 'timeout', 'network']);

let timer = null;
let draining = false;

function failureCode(error) {
  return String(error?.reasonCode || categorizeTournamentSyncError(error) || 'operation_failed')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .slice(0, 80);
}

async function audit(operation, status, details) {
  if (!operation.requestedActorId) return;
  await recordAdminAudit({
    actorId: operation.requestedActorId,
    actorName: operation.requestedActorName,
    action: `tournament.operation.${status}`,
    target: operation.id,
    details: {
      operation: operation.operation,
      tournamentId: operation.tournamentId,
      source: operation.source,
      status,
      ...details,
    },
  });
}

export async function drainTournamentOperations(client, { now = Date.now() / 1000, max = 5 } = {}) {
  if (draining) return 0;
  draining = true;
  let completed = 0;
  try {
    for (let index = 0; index < max; index += 1) {
      const claim = await claimNextTournamentOperation({ nowSec: now, leaseSeconds: LEASE_SECONDS });
      if (!claim) break;
      const { operation, leaseToken } = claim;
      try {
        const result = await runTournamentOperation(operation, {
          armMatch,
          stopTournament,
          refreshGuild: (guildId) => refreshGuild(client, guildId),
        });
        const finalized = await completeTournamentOperation({
          id: operation.id,
          leaseToken,
          resultCode: result.code,
          tournamentId: result.tournamentId,
        });
        if (finalized) {
          completed += 1;
          await audit(operation, 'succeeded', {
            resultCode: result.code,
            count: Number(result.count || 0),
            generation: result.generation,
          }).catch((error) => logger.error(`[tournament-operations] audit ${operation.id}: ${error.message}`));
        }
      } catch (error) {
        const code = failureCode(error);
        const retrying =
          RETRYABLE_FAILURES.has(code) &&
          operation.attempts < 20 &&
          (await requeueTournamentOperation({ id: operation.id, leaseToken, failureCode: code }));
        if (!retrying) {
          const finalized = await failTournamentOperation({
            id: operation.id,
            leaseToken,
            failureCode: code,
          });
          if (finalized) {
            await audit(operation, 'failed', { failureCode: code }).catch((auditError) =>
              logger.error(`[tournament-operations] audit ${operation.id}: ${auditError.message}`),
            );
          }
        }
        logger.warn(`[tournament-operations] ${operation.id} ${retrying ? 'requeued' : 'failed'}: ${code}`);
      }
    }
  } finally {
    draining = false;
  }
  return completed;
}

export function startTournamentOperations(client) {
  if (timer) return;
  const run = () =>
    drainTournamentOperations(client).catch((error) =>
      logger.error(`[tournament-operations] ${error.message}`),
    );
  timer = setInterval(run, POLL_MS);
  timer.unref?.();
  run();
  logger.info('[tournament-operations] consumer started (15s poll).');
}

export function stopTournamentOperations() {
  if (timer) clearInterval(timer);
  timer = null;
  draining = false;
}
