import { pathToFileURL } from 'node:url';

import { transaction } from '../src/db/client.js';
import {
  inspectEwcWeekGameReconciliation,
  listEwcWeeksForGameKeyReconciliation,
  reconcileEwcWeekGames,
} from '../src/db/ewcPredictions.js';
import { canonicalEwcEventIdentity, stableEwcGameKey } from '../src/lib/ewcPredictions.js';

export const APPLY_CONFIRMATION_FLAG = '--confirm-ewc-game-keys';

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

export function stableStoredGames(games) {
  if (!Array.isArray(games)) throw new Error('Stored games are not an array.');
  return games.map((game) => {
    if (!game || typeof game !== 'object' || Array.isArray(game)) {
      throw new Error('Stored game metadata is incomplete.');
    }
    return {
      ...game,
      key: stableEwcGameKey(game),
      eventIdentity: canonicalEwcEventIdentity(game),
    };
  });
}

function reportCounts(entries) {
  return entries.reduce(
    (totals, entry) => {
      totals.weeks += 1;
      if (entry.issue) {
        totals.unsafeWeeks += 1;
        return totals;
      }
      totals.unchanged += entry.report.unchanged.length;
      totals.rekeyed += entry.report.rekeyed.length;
      totals.added += entry.report.added.length;
      totals.removedUnreferenced += entry.report.removedUnreferenced.length;
      totals.ambiguous += entry.report.ambiguous.length;
      totals.unknownReferences += entry.report.unknownReferences.length;
      totals.referencedRemovals += entry.report.removedReferenced.length;
      if (entry.scoredKeyChange) totals.scoredKeyChanges += 1;
      if (entry.needsWrite) totals.weeksNeedingWrites += 1;
      if (!entry.report.ok || entry.scoredKeyChange) totals.unsafeWeeks += 1;
      return totals;
    },
    {
      weeks: 0,
      weeksNeedingWrites: 0,
      unchanged: 0,
      rekeyed: 0,
      added: 0,
      removedUnreferenced: 0,
      ambiguous: 0,
      unknownReferences: 0,
      referencedRemovals: 0,
      scoredKeyChanges: 0,
      unsafeWeeks: 0,
    },
  );
}

export async function collectGameKeyReport({ client = null, forUpdate = false } = {}) {
  const weeks = await listEwcWeeksForGameKeyReconciliation({ client, forUpdate });
  const entries = [];
  for (const week of weeks) {
    try {
      const games = stableStoredGames(week.games);
      const inspected = await inspectEwcWeekGameReconciliation(
        {
          guildId: week.guild_id,
          season: week.season,
          weekKey: week.week_key,
          games,
        },
        { client, forUpdate },
      );
      const scoredKeyChange =
        (week.status === 'scored' || Boolean(week.scored_at)) &&
        Boolean(
          inspected.report.rekeyed.length ||
            inspected.report.added.length ||
            inspected.report.removedUnreferenced.length,
        );
      entries.push({
        guildId: week.guild_id,
        season: week.season,
        weekKey: week.week_key,
        games,
        report: inspected.report,
        needsWrite: JSON.stringify(week.games) !== JSON.stringify(games),
        scoredKeyChange,
        issue: null,
      });
    } catch {
      entries.push({
        guildId: week.guild_id,
        season: week.season,
        weekKey: week.week_key,
        games: null,
        report: null,
        needsWrite: false,
        scoredKeyChange: false,
        issue: 'stored event metadata cannot be safely reconciled',
      });
    }
  }
  return { entries, totals: reportCounts(entries) };
}

function hasStopCondition(report) {
  return report.totals.unsafeWeeks > 0;
}

export function printReport(report) {
  const { totals } = report;
  console.log('EWC prediction game-key reconciliation (dry run)');
  console.log(`Stored weeks inspected: ${totals.weeks}`);
  console.log(`Weeks needing writes: ${totals.weeksNeedingWrites}`);
  console.log(`Game keys unchanged: ${totals.unchanged}`);
  console.log(`Game keys to rekey: ${totals.rekeyed}`);
  console.log(`Events to add: ${totals.added}`);
  console.log(`Unreferenced events to remove: ${totals.removedUnreferenced}`);
  console.log(`Unsafe weeks: ${totals.unsafeWeeks}`);
  if (hasStopCondition(report)) {
    console.log(
      `STOP: ambiguous events=${totals.ambiguous}; unknown references=${totals.unknownReferences}; ` +
        `referenced removals=${totals.referencedRemovals}; scored weeks with changes=${totals.scoredKeyChanges}. ` +
        'No changes were made.',
    );
  }
}

async function applyGameKeys() {
  return transaction(async (client) => {
    const report = await collectGameKeyReport({ client, forUpdate: true });
    if (hasStopCondition(report)) {
      throw new Error('STOP: game-key reconciliation became unsafe while acquiring transaction locks.');
    }
    let updatedWeeks = 0;
    for (const entry of report.entries) {
      if (!entry.needsWrite) continue;
      await reconcileEwcWeekGames(
        {
          guildId: entry.guildId,
          season: entry.season,
          weekKey: entry.weekKey,
          games: entry.games,
        },
        client,
      );
      updatedWeeks += 1;
    }
    return updatedWeeks;
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/rekey-ewc-prediction-games.mjs
  node scripts/rekey-ewc-prediction-games.mjs --apply ${APPLY_CONFIRMATION_FLAG}

The default is a read-only aggregate dry run. The command never fetches the
network or prints member picks. Apply is refused when identities are ambiguous,
stored references are unknown, referenced events would be removed, or a scored
round would require a key change.`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const report = await collectGameKeyReport();
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

  const updatedWeeks = await applyGameKeys();
  console.log(`Applied stable EWC game keys to ${updatedWeeks} stored week(s).`);
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
