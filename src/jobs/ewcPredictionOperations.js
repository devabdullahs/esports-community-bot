import {
  claimNextEwcPredictionOperation,
  completeEwcPredictionOperation,
  failEwcPredictionOperation,
  recordEwcPredictionAutomationHealth,
} from '../db/ewcPredictionOperations.js';
import { recordAdminAudit } from '../db/ewcAdminAuditLog.js';
import { runEwcPredictionAdminOperation } from '../lib/ewcPredictionAdmin.js';
import { logger } from '../lib/logger.js';
import { updateEwcPredictionLeaderboard } from './ewcPredictions.js';

const nowSec = () => Math.floor(Date.now() / 1000);
const POLL_MS = 15_000;
const LEASE_SECONDS = 300;

let timer = null;
let draining = false;

function executionAudit(operation, status, details = {}) {
  if (!operation.requestedActorId) return Promise.resolve();
  return recordAdminAudit({
    actorId: operation.requestedActorId,
    actorName: null,
    action: 'prediction.operation.completed',
    target: operation.id,
    details: { operation: operation.operation, season: operation.season, status, ...details },
  });
}

export async function drainEwcPredictionOperations(client, { now = nowSec(), max = 10 } = {}) {
  if (draining) return 0;
  draining = true;
  let completed = 0;
  try {
    for (let i = 0; i < max; i += 1) {
      const claim = await claimNextEwcPredictionOperation({ nowSec: now, leaseSeconds: LEASE_SECONDS });
      if (!claim) break;
      const { operation, leaseToken } = claim;
      try {
        // The callback is the sole Discord ownership point. The shared service
        // is command-free and the web runtime never imports this module.
        const result = await runEwcPredictionAdminOperation({
          guildId: operation.guildId,
          season: operation.season,
          operation: operation.operation,
          args: operation.args,
          actorId: operation.requestedActorId,
          effects: {
            refreshLeaderboard: async (guildId) => {
              try {
                return await updateEwcPredictionLeaderboard(client, guildId);
              } catch (error) {
                logger.warn(`[ewc-prediction-operations] leaderboard refresh ${guildId}: ${error.message}`);
                return false;
              }
            },
          },
          allowAlreadyComplete: true,
        });
        const finalized = await completeEwcPredictionOperation({ id: operation.id, leaseToken, result });
        if (finalized) {
          completed += 1;
          await recordEwcPredictionAutomationHealth({ guildId: operation.guildId, season: operation.season, ok: true }).catch((error) =>
            logger.error(`[ewc-prediction-operations] health ${operation.id}: ${error.message}`),
          );
          await executionAudit(operation, 'succeeded', { attempts: operation.attempts + 1 }).catch((error) =>
            logger.error(`[ewc-prediction-operations] audit ${operation.id}: ${error.message}`),
          );
        }
      } catch (error) {
        const finalized = await failEwcPredictionOperation({ id: operation.id, leaseToken, error: error.message });
        if (finalized) {
          await recordEwcPredictionAutomationHealth({ guildId: operation.guildId, season: operation.season, ok: false, error: error.message }).catch((healthError) =>
            logger.error(`[ewc-prediction-operations] health ${operation.id}: ${healthError.message}`),
          );
          await executionAudit(operation, 'failed', { attempts: operation.attempts + 1 }).catch((auditError) =>
            logger.error(`[ewc-prediction-operations] audit ${operation.id}: ${auditError.message}`),
          );
        }
        logger.warn(`[ewc-prediction-operations] ${operation.id}: ${error.message}`);
      }
    }
  } finally {
    draining = false;
  }
  return completed;
}

export function startEwcPredictionOperations(client) {
  if (timer) return;
  const run = () => drainEwcPredictionOperations(client).catch((error) => logger.error(`[ewc-prediction-operations] ${error.message}`));
  timer = setInterval(run, POLL_MS);
  timer.unref?.();
  run();
  logger.info('[ewc-prediction-operations] consumer started (15s poll).');
}

export function stopEwcPredictionOperations() {
  if (timer) clearInterval(timer);
  timer = null;
  draining = false;
}
