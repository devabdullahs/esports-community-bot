import assert from 'node:assert/strict';
import test from 'node:test';

import { hasTwoTeamLayout } from '../src/lib/matchCard.js';

test('uses two-team layout for TFT head-to-head lobby-game rows', () => {
  assert.equal(
    hasTwoTeamLayout({
      game: 'tft',
      source: 'liquipedia',
      external_id: 'tft:Esports_World_Cup/2026:bracket:0:mouz vs all gamers',
      team_a: 'MOUZ',
      team_b: 'All Gamers',
    }),
    true,
  );
});

test('uses single-event layout for literal lobby rows', () => {
  assert.equal(
    hasTwoTeamLayout({
      game: 'freefire',
      source: 'liquipedia',
      external_id: 'freefire:br-schedule:ewc:group-a:game-1',
      team_a: 'Group A - Game 1',
      team_b: 'Lobby',
    }),
    false,
  );
});

test('uses single-event layout for Liquipedia event detail rows', () => {
  assert.equal(
    hasTwoTeamLayout({
      game: 'apexlegends',
      source: 'liquipedia',
      external_id: 'apexlegends:event:1784620800:ALGS Championship - Finals',
      team_a: 'ALGS Championship',
      team_b: 'Finals',
    }),
    false,
  );
});
