import assert from 'node:assert/strict';
import test from 'node:test';

process.env.RENDER_MAX_CONCURRENT = '2';
process.env.RENDER_USER_COOLDOWN_MS = '5000';

const { tryAcquireRenderSlot, renderGateStats } = await import('../src/lib/renderGate.js');

test('per-user admission: a second render while one is in flight is refused', () => {
  const first = tryAcquireRenderSlot('user-a');
  assert.equal(first.ok, true);
  const second = tryAcquireRenderSlot('user-a');
  assert.deepEqual(second, { ok: false, reason: 'cooldown' });
  first.release();
  // Immediately after release the cooldown applies.
  const third = tryAcquireRenderSlot('user-a');
  assert.deepEqual(third, { ok: false, reason: 'cooldown' });
});

test('global ceiling: at most RENDER_MAX_CONCURRENT renders run at once and recovery works', () => {
  const one = tryAcquireRenderSlot('user-b');
  const two = tryAcquireRenderSlot('user-c');
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  const overflow = tryAcquireRenderSlot('user-d');
  assert.deepEqual(overflow, { ok: false, reason: 'busy' });
  one.release();
  const recovered = tryAcquireRenderSlot('user-e');
  assert.equal(recovered.ok, true);
  recovered.release();
  two.release();
  assert.equal(renderGateStats().activeRenders, 0);
});

test('release is idempotent and never underflows the counter', () => {
  const slot = tryAcquireRenderSlot('user-f');
  assert.equal(slot.ok, true);
  slot.release();
  slot.release();
  assert.equal(renderGateStats().activeRenders, 0);
});
