import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTournamentInput } from '../src/lib/parseTournamentInput.js';

test('parseTournamentInput preserves start.gg event scope', () => {
  const parsed = parseTournamentInput('https://www.start.gg/tournament/evo-2026/event/tekken-8');

  assert.deepEqual(parsed, {
    source: 'startgg',
    game: null,
    externalId: 'tournament/evo-2026/event/tekken-8',
    url: 'https://www.start.gg/tournament/evo-2026/event/tekken-8',
    name: 'Evo 2026: Tekken 8',
  });
});

test('parseTournamentInput keeps tournament-only start.gg URLs unchanged', () => {
  const parsed = parseTournamentInput('https://www.start.gg/tournament/evo-2026');

  assert.deepEqual(parsed, {
    source: 'startgg',
    game: null,
    externalId: 'evo-2026',
    url: 'https://www.start.gg/tournament/evo-2026',
    name: 'Evo 2026',
  });
});
