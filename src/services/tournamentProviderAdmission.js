import { dispatchWithActiveTournamentGeneration } from '../db/tournaments.js';

function staleGenerationError() {
  const error = new Error('Tournament lifecycle changed before provider dispatch.');
  error.reasonCode = 'stale_generation';
  return error;
}

export function tournamentProviderAdmissionOptions(tournamentId, generation) {
  const id = Number(tournamentId);
  const expectedGeneration = Number(generation);
  return {
    admissionKey: `tournament:${id}:${expectedGeneration}`,
    async beforeDispatch(dispatch) {
      const result = await dispatchWithActiveTournamentGeneration(id, expectedGeneration, dispatch);
      if (!result.applied) throw staleGenerationError();
      return result.value;
    },
  };
}
