import { pathToFileURL } from 'node:url';

import { all, dbDriver, transaction } from '../src/db/client.js';
import {
  canonicalMatchStatus,
  inferWinnerSideFromScores,
  normalizeMatchLifecycle,
} from '../src/lib/matchLifecycle.js';

export const APPLY_CONFIRMATION_FLAG = '--confirm-match-lifecycle';

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

function hasValue(value) {
  return value != null && value !== '';
}

function validCombination(row) {
  const normalized = normalizeMatchLifecycle(row);
  if (!normalized.status_known) return false;

  const winner = hasValue(row.winner_side) ? String(row.winner_side).toLowerCase() : null;
  const reason = hasValue(row.result_reason) ? String(row.result_reason).toLowerCase() : 'unknown';
  return (
    normalized.status === canonicalMatchStatus(row.status)
    && normalized.winner_side === winner
    && normalized.result_reason === reason
  );
}

export function classifyLifecycleRows(rows) {
  const report = {
    inspected: rows.length,
    scoreInferableWinners: 0,
    scorelessUnknownFinals: 0,
    cannotUpgrade: 0,
    invalidLegacyCombinations: 0,
    upgrades: [],
  };

  for (const row of rows) {
    const status = canonicalMatchStatus(row.status);
    const inferredWinner = status === 'finished'
      ? inferWinnerSideFromScores(row.score_a, row.score_b)
      : null;
    const hasTrustedWinner = hasValue(row.winner_side);

    if (status === 'finished' && !hasTrustedWinner && inferredWinner) {
      report.scoreInferableWinners += 1;
      report.upgrades.push({
        id: Number(row.id),
        winnerSide: inferredWinner,
        resultReason: 'normal',
      });
    } else if (status === 'finished' && !hasTrustedWinner) {
      report.scorelessUnknownFinals += 1;
      report.cannotUpgrade += 1;
    } else if (!status) {
      report.cannotUpgrade += 1;
    }

    if (!validCombination(row)) report.invalidLegacyCombinations += 1;
  }

  return report;
}

async function readRows(client = null, { forUpdate = false } = {}) {
  const runner = client || { all };
  const lock = forUpdate && dbDriver() === 'postgres' ? ' FOR UPDATE' : '';
  return runner.all(
    `SELECT id, score_a, score_b, status, winner_side, result_reason
       FROM matches
      ORDER BY id${lock}`,
  );
}

export async function collectReconciliationReport({ client = null, forUpdate = false } = {}) {
  return classifyLifecycleRows(await readRows(client, { forUpdate }));
}

export function printReport(report) {
  console.log('Match lifecycle reconciliation (dry run)');
  console.log(`Rows inspected: ${report.inspected}`);
  console.log(`Score-inferable winners: ${report.scoreInferableWinners}`);
  console.log(`Scoreless/unknown finals: ${report.scorelessUnknownFinals}`);
  console.log(`Rows that cannot be upgraded safely: ${report.cannotUpgrade}`);
  console.log(`Invalid legacy status/outcome combinations: ${report.invalidLegacyCombinations}`);
  console.log('No provider requests were made.');
}

async function applyReconciliation() {
  return transaction(async (client) => {
    const report = await collectReconciliationReport({ client, forUpdate: true });
    let changed = 0;

    for (const upgrade of report.upgrades) {
      const result = await client.run(
        `UPDATE matches
            SET winner_side = $1,
                result_reason = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
            AND status = 'finished'
            AND winner_side IS NULL
            AND score_a IS NOT NULL
            AND score_b IS NOT NULL
            AND score_a <> score_b`,
        [upgrade.winnerSide, upgrade.resultReason, upgrade.id],
      );
      changed += Number(result.changes ?? result.rowCount ?? 0);
    }

    return changed;
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/reconcile-match-lifecycle.mjs
  node scripts/reconcile-match-lifecycle.mjs --apply ${APPLY_CONFIRMATION_FLAG}

The default is a read-only aggregate report. Apply only fills winner/reason
fields when unequal scores already stored in the database prove the outcome.
It never fetches provider data and never infers postponed or cancelled states.`);
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

  const changed = await applyReconciliation();
  console.log(`Applied ${changed} evidence-backed lifecycle upgrade(s).`);
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
