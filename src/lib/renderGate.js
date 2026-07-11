// Shared admission control for native canvas rendering (security hardening
// ECB-SEC-013/018). @napi-rs/canvas work is CPU-bound and runs inside the
// single shared bot/web container, so member-triggered renders need both a
// global concurrency ceiling and a per-user cooldown — otherwise one member
// mashing a share/card command degrades match polling and the dashboard.
const MAX_CONCURRENT_RENDERS = Math.max(1, Number(process.env.RENDER_MAX_CONCURRENT || 2));
const PER_USER_COOLDOWN_MS = Math.max(0, Number(process.env.RENDER_USER_COOLDOWN_MS || 5_000));
const USER_STATE_MAX = 5_000;

let activeRenders = 0;
const inFlightUsers = new Set();
const lastFinishedAt = new Map(); // userId -> ms timestamp (bounded)

function rememberFinish(userId) {
  if (lastFinishedAt.size >= USER_STATE_MAX) {
    const oldest = lastFinishedAt.keys().next().value;
    if (oldest !== undefined) lastFinishedAt.delete(oldest);
  }
  lastFinishedAt.set(userId, Date.now());
}

/**
 * Try to reserve a render slot for a user. Returns { ok: true, release }
 * (release MUST be called in finally) or { ok: false, reason } where reason
 * is 'busy' (global ceiling) or 'cooldown' (per-user).
 */
export function tryAcquireRenderSlot(userId) {
  const id = String(userId || 'unknown');
  if (inFlightUsers.has(id)) return { ok: false, reason: 'cooldown' };
  const last = lastFinishedAt.get(id) || 0;
  if (Date.now() - last < PER_USER_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  if (activeRenders >= MAX_CONCURRENT_RENDERS) return { ok: false, reason: 'busy' };

  activeRenders += 1;
  inFlightUsers.add(id);
  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      activeRenders -= 1;
      inFlightUsers.delete(id);
      rememberFinish(id);
    },
  };
}

export function renderGateStats() {
  return { activeRenders, inFlightUsers: inFlightUsers.size, cooldownEntries: lastFinishedAt.size };
}
