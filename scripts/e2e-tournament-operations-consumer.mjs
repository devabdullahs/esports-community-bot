import process from 'node:process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const expected = args.get('--expected');
const action = args.get('--action');
const name = args.get('--name');
const url = args.get('--url');
const guildId = String(process.env.DISCORD_GUILD_ID || '');

if (
  !expected ||
  !['stage', 'complete', 'archive', 'reactivate'].includes(action) ||
  !/^\d{1,32}$/.test(guildId)
) {
  throw new Error('Invalid E2E tournament consumer arguments.');
}

const { closeDbClient } = await import('../src/db/client.js');
const {
  claimNextTournamentOperation,
  completeTournamentOperation,
} = await import('../src/db/tournamentOperations.js');
const {
  addTournament,
  archiveTournament,
  reactivateTournament,
} = await import('../src/db/tournaments.js');

try {
  const claimed = await claimNextTournamentOperation({ leaseSeconds: 60 });
  if (!claimed) throw new Error('No queued tournament operation was available.');
  if (claimed.operation.operation !== expected) {
    throw new Error(
      `Expected ${expected}, received ${claimed.operation.operation}.`,
    );
  }

  let tournamentId = claimed.operation.tournamentId;
  if (action === 'stage') {
    if (
      claimed.operation.source !== 'liquipedia' ||
      !claimed.operation.sourceId ||
      !name ||
      !url
    ) {
      throw new Error('The staged validation request is incomplete.');
    }
    const tournament = await addTournament({
      source: claimed.operation.source,
      external_id: claimed.operation.sourceId,
      game: claimed.operation.game || 'valorant',
      name,
      url,
      guild_id: guildId,
      added_by: 'e2e-fake-consumer',
    });
    tournamentId = Number(tournament.id);
  } else if (action === 'archive') {
    const tournament = await archiveTournament(tournamentId, guildId);
    if (!tournament) throw new Error('The tournament could not be archived.');
  } else if (action === 'reactivate') {
    const tournament = await reactivateTournament(tournamentId, guildId);
    if (!tournament) throw new Error('The tournament could not be reactivated.');
  }

  const completed = await completeTournamentOperation({
    id: claimed.operation.id,
    leaseToken: claimed.leaseToken,
    resultCode: 'e2e_completed',
    tournamentId,
  });
  if (!completed) throw new Error('The claimed operation could not be completed.');

  console.log(`E2E_RESULT ${JSON.stringify({
    operation: claimed.operation.operation,
    tournamentId,
  })}`);
} finally {
  await closeDbClient();
}
