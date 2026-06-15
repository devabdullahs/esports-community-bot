import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampText,
  stripUnsupportedMarkdown,
  truncateForDiscord,
  prepareBodyForDiscord,
} from '../src/lib/discordContent.js';

test('stripUnsupportedMarkdown drops image embeds but keeps links and emphasis', () => {
  const input = 'Lead **bold** and a [link](https://x.test).\n\n![cover](https://img.test/a.png)\n\nMore text.';
  const out = stripUnsupportedMarkdown(input);
  assert.ok(!out.includes('!['), 'image markdown removed');
  assert.ok(out.includes('**bold**'), 'bold kept');
  assert.ok(out.includes('[link](https://x.test)'), 'link kept');
  assert.ok(out.includes('More text.'), 'trailing text kept');
});

test('stripUnsupportedMarkdown removes stray HTML and collapses blank lines', () => {
  const out = stripUnsupportedMarkdown('a<br/>b\n\n\n\nc');
  assert.equal(out, 'ab\n\nc');
});

test('truncateForDiscord leaves short text untouched', () => {
  assert.equal(truncateForDiscord('short', 100), 'short');
});

test('truncateForDiscord caps at a word boundary with an ellipsis', () => {
  const text = `${'word '.repeat(50)}tail`; // 254 chars
  const out = truncateForDiscord(text, 40);
  assert.ok(out.length <= 40, `length ${out.length} within cap`);
  assert.ok(out.endsWith('…'), 'ends with ellipsis');
  assert.ok(!/\sword$/.test(out.slice(0, -1)) || out.slice(0, -1).endsWith('word'), 'cut on a boundary');
  assert.ok(!out.slice(0, -1).endsWith(' '), 'no trailing space before ellipsis');
});

test('truncateForDiscord prefers a paragraph break when one is late enough', () => {
  const text = `${'a'.repeat(30)}\n\n${'b'.repeat(30)}`;
  const out = truncateForDiscord(text, 40);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('b'), 'truncated before the second paragraph');
});

test('prepareBodyForDiscord strips images then caps', () => {
  const body = `Intro paragraph.\n\n![x](https://img.test/x.png)\n\n${'tail '.repeat(2000)}`;
  const out = prepareBodyForDiscord(body, 4096);
  assert.ok(out.length <= 4096);
  assert.ok(!out.includes('!['));
  assert.ok(out.startsWith('Intro paragraph.'));
});

test('clampText hard-caps without an ellipsis', () => {
  assert.equal(clampText('abcdef', 3), 'abc');
  assert.equal(clampText('ab', 3), 'ab');
  assert.equal(clampText(null, 3), '');
});
