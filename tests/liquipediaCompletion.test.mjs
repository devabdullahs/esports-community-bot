import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { parseMatchlistMatch, parseBracketMatch, parseSwissMatches, mergeLiveWidgetMatch } from '../src/services/liquipedia/parsers.js';
import { normalizeMatchLifecycle } from '../src/lib/matchLifecycle.js';

function matchlist({ marker = '', a = 2, b = 2, attributes = '', extra = '' } = {}) {
  const $ = load(`<div class="brkts-matchlist-match" ${attributes}>
    <div class="brkts-matchlist-opponent ${marker}" aria-label="Alpha"></div>
    <div class="brkts-matchlist-score"><span class="brkts-matchlist-cell-content">${a}</span><span class="brkts-matchlist-cell-content">${b}</span></div>
    <div class="brkts-matchlist-opponent ${marker === 'bg-draw' ? marker : ''}" aria-label="Beta"></div>
    ${extra}</div>`);
  return parseMatchlistMatch($, $('.brkts-matchlist-match')[0], 'easportsfc', 'Season');
}

test('a final ticker result replaces a stale bracket partial in the correct orientation', () => {
  const match = { teamA: 'Alpha', teamB: 'Beta', scoreA: 1, scoreB: 0, status: 'running' };
  assert.equal(mergeLiveWidgetMatch(match, { teamA: 'Beta', teamB: 'Alpha', scoreA: 2, scoreB: 3, status: 'finished', winner: 'Alpha' }), true);
  assert.equal(match.status, 'finished');
  assert.equal(match.scoreA, 3);
  assert.equal(match.scoreB, 2);
  assert.equal(match.winner, 'Alpha');
});

test('untimed FC draws finish, including a confirmed scoreless draw', () => {
  for (const score of [0, 2]) {
    const match = matchlist({ marker: 'bg-draw', a: score, b: score });
    assert.equal(match.scheduledAt, null);
    assert.equal(match.status, 'finished');
    assert.equal(normalizeMatchLifecycle(match).winner_side, 'draw');
    assert.equal(normalizeMatchLifecycle(match).result_reason, 'normal');
  }
});

test('equal scores alone do not complete an ongoing FC match', () => {
  assert.equal(matchlist().status, 'running');
  assert.equal(matchlist({ a: 0, b: 0 }).status, 'scheduled');
});

test('match-level completion overrides a partial-looking series score', () => {
  for (const attributes of ['data-status="finished"', 'data-status="completed"']) {
    assert.equal(matchlist({ attributes, a: 1, b: 0, extra: '<div class="brkts-popup">(Bo5)</div>' }).status, 'finished');
  }
});

test('final round titles and finished countdowns are not completed matches', () => {
  assert.equal(matchlist({ a: 1, b: 0, extra: '<div class="brkts-popup">Final</div><span class="timer-object" data-finished="finished"></span>' }).status, 'running');
});

test('winner styling on the opponent itself completes untimed brackets', () => {
  const $ = load(`<div class="brkts-match"><div class="brkts-opponent-entry brkts-opponent-win" aria-label="Alpha"><span class="brkts-opponent-score-inner">2</span></div><div class="brkts-opponent-entry" aria-label="Beta"><span class="brkts-opponent-score-inner">1</span></div></div>`);
  const match = parseBracketMatch($, $('.brkts-match')[0], 'easportsfc');
  assert.equal(match.status, 'finished');
  assert.equal(match.winner, 'Alpha');
});

test('legacy winner backgrounds complete match-list rows', () => {
  const match = matchlist({ marker: 'bg-win', a: 2, b: 1 });
  assert.equal(match.status, 'finished');
  assert.equal(match.winner, 'Alpha');
});

test('cancellation still takes precedence over completed-score styling', () => {
  assert.equal(matchlist({ marker: 'bg-draw', attributes: 'data-status="cancelled"' }).status, 'cancelled');
});

test('legacy Swiss draws are completed results rather than permanent live rows', () => {
  for (const score of [0, 2]) {
    const $ = load(`<table class="swisstable"><tr><th>Team</th><th>Round</th></tr><tr><td><span data-highlightingclass="Alpha">Alpha</span></td><td class="swisstable-bgc-draw"><span data-highlightingclass="Beta">Beta</span>${score}:${score}</td></tr></table>`);
    const [match] = parseSwissMatches($, 'easportsfc');
    assert.equal(match.status, 'finished');
    assert.equal(match.winnerSide, 'draw');
  }
});
