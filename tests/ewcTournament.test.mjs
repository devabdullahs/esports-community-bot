import assert from 'node:assert/strict';
import test from 'node:test';

import { isEwcTournamentReference } from '../src/lib/ewcTournament.js';

test('isEwcTournamentReference recognizes explicit EWC branding and stored flags', () => {
  assert.equal(isEwcTournamentReference({ ewc: 1 }), true);
  assert.equal(isEwcTournamentReference({ external_id: 'fighters/Esports_World_Cup/2026/CotW' }), true);
  assert.equal(isEwcTournamentReference({ name: 'FC Pro at Esports World Cup 2026' }), true);
});

test('isEwcTournamentReference recognizes the verified MWI 2026 aliases', () => {
  assert.equal(isEwcTournamentReference({ external_id: 'mobilelegends/MWI/2026' }), true);
  assert.equal(isEwcTournamentReference({ external_id: "mobilelegends/MLBB_Women's_International/2026" }), true);
});

test('isEwcTournamentReference does not broaden World Cup or MWI qualifier events', () => {
  assert.equal(isEwcTournamentReference({ external_id: 'pubgmobile/PUBG_Mobile_World_Cup/2026' }), false);
  assert.equal(isEwcTournamentReference({ external_id: 'overwatch/Overwatch_World_Cup/2026' }), false);
  assert.equal(isEwcTournamentReference({ external_id: 'mobilelegends/MWI/2026/Qualifier' }), false);
});
