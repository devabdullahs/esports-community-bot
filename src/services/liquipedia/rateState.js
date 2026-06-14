import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '../../lib/logger.js';

const RATE_STATE_PATH =
  process.env.LIQUIPEDIA_RATE_STATE_PATH ||
  join(/* turbopackIgnore: true */ process.cwd(), 'data', 'liquipedia-rate-limit.json');

// Mutable state object — exported by reference so client.js can read and write fields directly.
export const rateState = {
  lastRequestAt: 0,
  blockedUntil: 0,
  loaded: false,
};

export function loadRateState({ force = false } = {}) {
  if (rateState.loaded && !force) return;
  rateState.loaded = true;
  try {
    const data = JSON.parse(readFileSync(RATE_STATE_PATH, 'utf8'));
    rateState.lastRequestAt = Number(data.lastRequestAt) || 0;
    rateState.blockedUntil = Number(data.blockedUntil) || 0;
  } catch {
    // Missing or invalid state just means this is the first run.
  }
}

export function saveRateState() {
  try {
    mkdirSync(dirname(RATE_STATE_PATH), { recursive: true });
    writeFileSync(
      RATE_STATE_PATH,
      JSON.stringify({ lastRequestAt: rateState.lastRequestAt, blockedUntil: rateState.blockedUntil }, null, 2),
    );
  } catch (e) {
    logger.debug(`[liquipedia] could not save rate state: ${e.message}`);
  }
}

export function markRateLimited(durationMs) {
  loadRateState({ force: true });
  rateState.blockedUntil = Math.max(rateState.blockedUntil, Date.now() + durationMs);
  saveRateState();
}
