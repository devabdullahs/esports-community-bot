import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from '../../lib/logger.js';

const RATE_STATE_PATH = resolve(process.env.LIQUIPEDIA_RATE_STATE_PATH || 'data/liquipedia-rate-limit.json');

// Mutable state object — exported by reference so client.js can read and write fields directly.
export const rateState = {
  lastRequestAt: 0,
  blockedUntil: 0,
  loaded: false,
};

export function loadRateState() {
  if (rateState.loaded) return;
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
