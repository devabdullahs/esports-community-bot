import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEEKLY_PICKER_PAGE_SIZE,
  weeklyModalSelection,
  weeklyPickerPage,
  weeklyPickerPageForGame,
} from '../src/lib/ewcWeeklyPicker.js';

function games(count) {
  return Array.from({ length: count }, (_, index) => ({ key: `game-${index + 1}`, game: `Game ${index + 1}`, lockAt: 10_000 }));
}

for (const count of [0, 1, 12, 13, 25, 40]) {
  test(`weeklyPickerPage reaches every configured game in a ${count}-game round`, () => {
    const allGames = games(count);
    const first = weeklyPickerPage(allGames, [], 0, 1_000);
    const rendered = Array.from({ length: first.totalPages }, (_, page) => weeklyPickerPage(allGames, [], page, 1_000))
      .flatMap((model) => model.games.map((game) => game.key));
    assert.deepEqual(rendered, allGames.map((game) => game.key));
    assert.ok(first.games.length <= WEEKLY_PICKER_PAGE_SIZE);
    assert.equal(weeklyPickerPage(allGames, [], 9_999, 1_000).page, first.totalPages - 1);
    assert.equal(weeklyPickerPage(allGames, [], -1, 1_000).page, 0);
  });
}

test('weeklyPickerPageForGame returns the page containing a submitted game', () => {
  const allGames = games(40);
  assert.equal(weeklyPickerPageForGame(allGames, 'game-1'), 0);
  assert.equal(weeklyPickerPageForGame(allGames, `game-${WEEKLY_PICKER_PAGE_SIZE + 1}`), 1);
  assert.equal(weeklyPickerPageForGame(allGames, 'missing'), 0);
});

test('weeklyModalSelection treats manual text as authoritative and rejects ambiguous selectors', () => {
  assert.deepEqual(weeklyModalSelection({ manual: '  Team Falcons ', selections: ['A', 'B'] }), { kind: 'pick', pick: 'Team Falcons' });
  assert.deepEqual(weeklyModalSelection({ manual: '', selections: ['A'] }), { kind: 'pick', pick: 'A' });
  assert.deepEqual(weeklyModalSelection({ manual: '', selections: [] }), { kind: 'empty' });
  assert.deepEqual(weeklyModalSelection({ manual: '', selections: ['A', 'B'] }), { kind: 'ambiguous' });
  assert.deepEqual(weeklyModalSelection({ manual: '', selections: ['Current pick'] }), { kind: 'pick', pick: 'Current pick' });
});
