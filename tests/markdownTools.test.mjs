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
