import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '../lib/logger.js';

const RATE_STATE_PATH =
  process.env.LPDB_RATE_STATE_PATH ||
  join(/* turbopackIgnore: true */ process.cwd(), 'data', 'lpdb-rate-limit.json');

function cleanState(value) {
  const timestamp = (candidate) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    lastRequestAt: timestamp(value?.lastRequestAt),
    blockedUntil: timestamp(value?.blockedUntil),
  };
}

export function loadLpdbRateState() {
  try {
    return cleanState(JSON.parse(readFileSync(/* turbopackIgnore: true */ RATE_STATE_PATH, 'utf8')));
  } catch {
    return cleanState();
  }
}

export function saveLpdbRateState(state) {
  const next = cleanState(state);
  const tempPath = `${RATE_STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(/* turbopackIgnore: true */ dirname(RATE_STATE_PATH), { recursive: true });
    writeFileSync(/* turbopackIgnore: true */ tempPath, JSON.stringify(next, null, 2));
    renameSync(/* turbopackIgnore: true */ tempPath, RATE_STATE_PATH);
  } catch (error) {
    try {
      rmSync(/* turbopackIgnore: true */ tempPath, { force: true });
    } catch {
      // Nothing useful to do if a best-effort cleanup also fails.
    }
    logger.debug(`[lpdb] could not save rate state: ${error.message}`);
  }
}
