import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoalescedRefresh } from '../src/lib/coalescedRefresh.js';

function harness(run, onError) {
  const timers = new Map();
  let id = 0;
  const queue = createCoalescedRefresh(run, {
    onError,
    schedule: callback => { timers.set(++id, callback); return id; },
    cancel: key => timers.delete(key),
  });
  const fire = () => {
    const [key, callback] = timers.entries().next().value;
    timers.delete(key);
    return callback();
  };
  return { ...queue, timers, fire };
}

test('bursts during a slow refresh collapse into one follow-up with the latest state', async () => {
  let release;
  const calls = [];
  const h = harness(async (key, value) => {
    calls.push([key, value]);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
  });
  h.request('guild', 1);
  h.request('guild', 2);
  assert.equal(h.timers.size, 1);
  const running = h.fire();
  for (let value = 3; value <= 100; value++) h.request('guild', value);
  assert.equal(h.timers.size, 0);
  release();
  await running;
  assert.equal(h.timers.size, 1);
  await h.fire();
  assert.deepEqual(calls, [['guild', 2], ['guild', 100]]);
  assert.equal(h.timers.size, 0);
});

test('failed refresh releases the key so later retries can run', async () => {
  const errors = [];
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) throw new Error('offline'); }, error => errors.push(error.message));
  h.request('guild', null);
  await h.fire();
  h.request('guild', null);
  await h.fire();
  assert.equal(calls, 2);
  assert.deepEqual(errors, ['offline']);
});

test('shutdown cancels pending work and suppresses follow-ups from in-flight work', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  h.request('running', null);
  const running = h.fire();
  h.request('running', null);
  h.request('pending', null);
  h.stop();
  release();
  await running;
  h.request('later', null);
  assert.equal(h.timers.size, 0);
});
