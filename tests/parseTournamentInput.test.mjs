import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTournamentInput } from '../src/lib/parseTournamentInput.js';

test('parseTournamentInput normalizes a legacy url: prefix', () => {
  assert.deepEqual(
    parseTournamentInput('url:https://liquipedia.net/mobilelegends/MWI/2026'),
    {
      source: 'liquipedia',
      game: 'mobilelegends',
      externalId: 'mobilelegends/MWI/2026',
      url: 'https://liquipedia.net/mobilelegends/MWI/2026',
      name: 'MWI 2026',
    },
  );
});

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

test('parseTournamentInput canonicalizes plural start.gg events scope', () => {
  const parsed = parseTournamentInput('https://www.start.gg/tournament/evo-2026/events/street-fighter-6');

  assert.deepEqual(parsed, {
    source: 'startgg',
    game: null,
    externalId: 'tournament/evo-2026/event/street-fighter-6',
    url: 'https://www.start.gg/tournament/evo-2026/event/street-fighter-6',
    name: 'Evo 2026: Street Fighter 6',
  });
});

test('parseTournamentInput rejects path and authority confusion before dispatch', () => {
  const rejected = [
    'https://liquipedia.net.evil.test/valorant/Event',
    'https://evil.test@liquipedia.net/valorant/Event',
    'https://liquipedia.net:443/valorant/Event',
    'https://liquipedia.net/valorant/../Event',
    'https://liquipedia.net/valorant/%2e%2e/Event',
    'https://liquipedia.net/valorant/Event%252fOther',
    'https://liquipedia.net/valorant/Event?raw=1',
    'https://start.gg/tournament/evo-2026/event/tekken-8/brackets/1',
    'startgg:evo-2026/../../other',
    'liquipedia:valorant/Event%2fOther',
    'pandascore:12/34',
  ];
  for (const value of rejected) assert.equal(parseTournamentInput(value), null, value);
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
