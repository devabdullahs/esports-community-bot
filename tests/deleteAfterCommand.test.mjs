import assert from 'node:assert/strict';
import test from 'node:test';
import { Collection } from 'discord.js';
import { collectMessagesAfter } from '../src/commands/delete_after.js';

function compareSnowflakeDesc(a, b) {
  const av = BigInt(a.id);
  const bv = BigInt(b.id);
  if (av === bv) return 0;
  return av > bv ? -1 : 1;
}

function message(id) {
  return {
    id: String(id),
    createdTimestamp: Date.now(),
    pinned: false,
  };
}

function channelWithMessages(ids) {
  const calls = [];
  const messages = ids.map(message).sort(compareSnowflakeDesc);

  return {
    calls,
    messages: {
      async fetch(options) {
        calls.push({ ...options });
        const page = messages
          .filter((item) => !options.before || BigInt(item.id) < BigInt(options.before))
          .slice(0, options.limit);
        return new Collection(page.map((item) => [item.id, item]));
      },
    },
  };
}

test('collectMessagesAfter returns only messages newer than the selected message', async () => {
  const channel = channelWithMessages([105, 104, 103, 102, 101, 100, 99, 98]);

  const result = await collectMessagesAfter(channel, '100');

  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.messages.map((item) => item.id),
    ['105', '104', '103', '102', '101'],
  );
});

test('collectMessagesAfter paginates until the selected message boundary', async () => {
  const channel = channelWithMessages(Array.from({ length: 151 }, (_, index) => 200 - index));

  const result = await collectMessagesAfter(channel, '75');

  assert.equal(result.truncated, false);
  assert.equal(result.messages.length, 125);
  assert.equal(result.messages[0].id, '200');
  assert.equal(result.messages.at(-1).id, '76');
  assert.equal(channel.calls.length, 2);
});

test('collectMessagesAfter truncates cleanups above the safety limit', async () => {
  const channel = channelWithMessages([120, 119, 118, 117, 116, 115, 114, 113, 112, 111, 110]);

  const result = await collectMessagesAfter(channel, '100', { maxMessages: 5 });

  assert.equal(result.truncated, true);
  assert.equal(result.messages.length, 5);
  assert.equal(result.counted, 6);
});
