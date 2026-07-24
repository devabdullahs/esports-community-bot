import { pathToFileURL } from 'node:url';

import { transaction } from '../src/db/client.js';
import {
  listEwcWeeksForTimezoneReconciliation,
  listWeeklyPredictions,
  updateEwcWeekTimingForTimezoneReconciliation,
} from '../src/db/ewcPredictions.js';
import { reconcileStoredEwc2026Week } from '../src/lib/ewcPredictions.js';

export const APPLY_CONFIRMATION_FLAG = '--confirm-ewc-2026-timezone';

export function parseArgs(argv) {
  const args = { apply: false, confirmed: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === APPLY_CONFIRMATION_FLAG) args.confirmed = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isAlreadyScored(week) {
  return week.status === 'scored' || Boolean(week.scored_at);
}

function affectedPredictionCounts(predictions, intervals) {
  const counts = new Map(intervals.map((interval) => [String(interval.gameKey ?? ''), 0]));
  const byGame = new Map(intervals.map((interval) => [String(interval.gameKey ?? ''), interval]));
  for (const prediction of predictions) {
    for (const pick of prediction.picks || []) {
      if (!pick || typeof pick !== 'object') continue;
      const interval = byGame.get(String(pick.gameKey ?? ''));
      const pickedAt = Number(pick.pickedAt);
      if (!interval || !Number.isFinite(pickedAt)) continue;
      if (pickedAt >= interval.newLockAt && pickedAt < interval.oldLockAt) {
        const gameKey = String(pick.gameKey ?? '');
        counts.set(gameKey, (counts.get(gameKey) || 0) + 1);
      }
    }
  }
  return counts;
}

export async function collectReconciliationReport({ client = null, forUpdate = false } = {}) {
  const weeks = await listEwcWeeksForTimezoneReconciliation('2026', { client, forUpdate });
  const entries = [];

  for (const week of weeks) {
    const entry = {
      id: week.id,
      weekKey: week.week_key,
      alreadyScored: isAlreadyScored(week),
      reconciliation: null,
      affectedPredictionsByGame: new Map(),
      metadataIssue: null,
    };
    try {
      entry.reconciliation = reconcileStoredEwc2026Week(week);
    } catch {
      entry.metadataIssue = 'stored event metadata cannot be safely reconciled';
    }
    if (entry.reconciliation) {
      const predictions = await listWeeklyPredictions(week.id, client, { forUpdate });
      entry.affectedPredictionsByGame = affectedPredictionCounts(predictions, entry.reconciliation.invalidSubmissionIntervals);
    }
    entries.push(entry);
  }

  const affectedPredictions = entries.reduce(
    (sum, entry) => sum + [...entry.affectedPredictionsByGame.values()].reduce((gameSum, count) => gameSum + count, 0),
    0,
  );
  return {
    entries,
    affectedPredictions,
    scoredWeeks: entries.filter((entry) => entry.alreadyScored).length,
    metadataIssues: entries.filter((entry) => entry.metadataIssue).length,
  };
}

function hasStopCondition(report) {
  return report.affectedPredictions > 0 || report.scoredWeeks > 0 || report.metadataIssues > 0;
}

function fieldNames(fields) {
  return fields.length ? fields.map((field) => field.field).join(', ') : 'none';
}

export function printReport(report) {
  console.log('EWC 2026 Riyadh timezone reconciliation (dry run)');
  console.log(`Stored weeks inspected: ${report.entries.length}`);
  for (const entry of report.entries) {
    console.log(`Week ${entry.weekKey}: already scored: ${entry.alreadyScored ? 'yes' : 'no'}`);
    if (entry.metadataIssue) {
      console.log(`  metadata: ${entry.metadataIssue}`);
      continue;
    }
    console.log(`  week fields: ${fieldNames(entry.reconciliation.diff.week)}`);
    for (const game of entry.reconciliation.diff.games) {
      const affected = entry.affectedPredictionsByGame.get(String(game.gameKey ?? '')) || 0;
      console.log(`  game ${game.gameKey ?? '(missing key)'}: fields ${fieldNames(game.fields)}; invalid-window predictions: ${affected}`);
    }
  }
  console.log(`Affected invalid-window predictions: ${report.affectedPredictions}`);
  if (hasStopCondition(report)) {
    console.log(
      `STOP: scored weeks=${report.scoredWeeks}; affected invalid-window predictions=${report.affectedPredictions}; metadata issues=${report.metadataIssues}. No changes were made.`,
    );
  }
}

async function applyReconciliation() {
  return transaction(async (client) => {
    const report = await collectReconciliationReport({ client, forUpdate: true });
    if (hasStopCondition(report)) {
      throw new Error('STOP: reconciliation became unsafe while acquiring transaction locks.');
    }

    let updatedWeeks = 0;
    for (const entry of report.entries) {
      const corrected = entry.reconciliation.corrected;
      const changed = entry.reconciliation.diff.week.length || entry.reconciliation.diff.games.length;
      if (!changed) continue;
      const updates = await updateEwcWeekTimingForTimezoneReconciliation(
        {
          weekId: entry.id,
          startAt: corrected.startAt,
          endAt: corrected.endAt,
          openAt: corrected.openAt,
          closeAt: corrected.closeAt,
          scoreAfter: corrected.scoreAfter,
          games: corrected.games,
        },
        client,
      );
      if (updates !== 1) {
        throw new Error('STOP: a stored week was no longer eligible for reconciliation.');
      }
      updatedWeeks += 1;
    }
    return updatedWeeks;
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/reconcile-ewc-2026-timezone.mjs
  node scripts/reconcile-ewc-2026-timezone.mjs --apply ${APPLY_CONFIRMATION_FLAG}

The default is a read-only dry run. Apply is refused when stored picks fall in a
newly invalid lock window, when a week is already scored, or when stored event
metadata cannot be safely matched to the official 2026 schedule.`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const report = await collectReconciliationReport();
  printReport(report);
  if (!args.apply) return 0;
  if (!args.confirmed) {
    console.error(`Refusing apply: pass ${APPLY_CONFIRMATION_FLAG} with --apply after reviewing the dry run.`);
    return 1;
  }
  if (hasStopCondition(report)) {
    console.error('STOP: apply refused because the dry-run report contains unsafe rows.');
    return 1;
  }

  const updatedWeeks = await applyReconciliation();
  console.log(`Applied Riyadh timing reconciliation to ${updatedWeeks} stored week(s).`);
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
