import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMarkdownActiveState,
  toggleLinePrefix,
  toggleWrap,
} from '../src/lib/markdownTools.js';

test('toggleWrap wraps and unwraps selected inline markdown', () => {
  const wrapped = toggleWrap('Falcons win', 0, 7, '**');
  assert.equal(wrapped.text, '**Falcons** win');
  assert.equal(wrapped.selStart, 2);
  assert.equal(wrapped.selEnd, 9);

  const unwrapped = toggleWrap(wrapped.text, wrapped.selStart, wrapped.selEnd, '**');
  assert.equal(unwrapped.text, 'Falcons win');
  assert.equal(unwrapped.selStart, 0);
  assert.equal(unwrapped.selEnd, 7);
});

test('toggleWrap detects active inline markdown at the cursor', () => {
  const state = getMarkdownActiveState('A **big** result', 5, 5);
  assert.equal(state.bold, true);
  assert.equal(state.italic, false);
});

test('toggleLinePrefix adds and removes bullet prefixes for selected lines', () => {
  const listed = toggleLinePrefix('Alpha\nBeta', 0, 10, { prefix: '- ' });
  assert.equal(listed.text, '- Alpha\n- Beta');

  const unlisted = toggleLinePrefix(listed.text, 0, listed.text.length, { prefix: '- ' });
  assert.equal(unlisted.text, 'Alpha\nBeta');
});

test('toggleLinePrefix removes numbered list prefixes when every line is numbered', () => {
  const unlisted = toggleLinePrefix('1. Alpha\n2. Beta', 0, 17, { numbered: true });
  assert.equal(unlisted.text, 'Alpha\nBeta');
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('toggleWrap with zero-length selection (cursor only) inserts empty marker pair and places cursor inside', () => {
  // Cursor at position 5 in "hello world"; no text is selected.
  // The function should insert ** ** at the cursor and leave the caret between them.
  const result = toggleWrap('hello world', 5, 5, '**');
  assert.equal(result.text, 'hello**** world');
  // Cursor sits between the two markers
  assert.equal(result.selStart, 7);
  assert.equal(result.selEnd, 7);
});

test('toggleWrap on text already wrapped unwraps it when selection covers the markers', () => {
  // "**bold**" fully selected — the selected text starts and ends with the marker,
  // so toggleWrap strips the outer markers.
  const result = toggleWrap('**bold**', 0, 8, '**');
  assert.equal(result.text, 'bold');
  assert.equal(result.selStart, 0);
  assert.equal(result.selEnd, 4);
});

test('toggleWrap on empty string inserts marker pair at position 0', () => {
  // Empty input is valid; the cursor-only branch fires (selected === '').
  const result = toggleWrap('', 0, 0, '**');
  assert.equal(result.text, '****');
  assert.equal(result.selStart, 2);
  assert.equal(result.selEnd, 2);
});

test('toggleLinePrefix adds bullet prefix to multi-line selection spanning three lines', () => {
  const text = 'Line one\nLine two\nLine three';
  // Select across all three lines
  const listed = toggleLinePrefix(text, 0, text.length, { prefix: '- ' });
  assert.equal(listed.text, '- Line one\n- Line two\n- Line three');
  // Toggle again to remove prefixes from all three lines
  const unlisted = toggleLinePrefix(listed.text, 0, listed.text.length, { prefix: '- ' });
  assert.equal(unlisted.text, 'Line one\nLine two\nLine three');
});
