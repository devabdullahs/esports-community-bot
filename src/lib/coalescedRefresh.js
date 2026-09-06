// At most one running refresh and one follow-up per key, even during event bursts.
export function createCoalescedRefresh(run, { delayMs = 2500, onError = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const pending = new Map();
  let stopped = false;
  function request(key, value) {
    if (stopped || !key) return;
    const existing = pending.get(key);
    if (existing) {
      existing.value = value;
      if (existing.running) existing.dirty = true;
      return;
    }
    const state = { value, running: false, dirty: false, timer: null };
    pending.set(key, state);
    state.timer = schedule(async () => {
      state.running = true;
      try {
        await run(key, state.value);
      } catch (error) {
        onError(error, key);
      } finally {
        pending.delete(key);
        if (state.dirty && !stopped) request(key, state.value);
      }
    }, delayMs);
    state.timer?.unref?.();
  }
  function stop() {
    stopped = true;
    for (const state of pending.values()) if (!state.running) cancel(state.timer);
    pending.clear();
  }
  return { request, stop };
}
