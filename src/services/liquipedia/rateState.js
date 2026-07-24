import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '../../lib/logger.js';

const RATE_STATE_PATH =
  process.env.LIQUIPEDIA_RATE_STATE_PATH ||
  join(/* turbopackIgnore: true */ process.cwd(), 'data', 'liquipedia-rate-limit.json');

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
}

function readTimestamp(value, fallback = 0) {
  if (value === undefined) return fallback;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('invalid timestamp');
  return timestamp;
}

export function createRateStateStore({
  rateStatePath = RATE_STATE_PATH,
  now = () => Date.now(),
  fileSystem = { mkdirSync, readFileSync, renameSync, writeFileSync },
  log = logger,
} = {}) {
  // Mutable by design: the MediaWiki client and logo downloader share this state.
  const state = {
    lastRequestAt: 0,
    lastParseAt: 0,
    blockedUntil: 0,
    loaded: false,
  };

  function loadRateState({ force = false } = {}) {
    if (state.loaded && !force) return;
    state.loaded = true;
    try {
      const data = JSON.parse(fileSystem.readFileSync(/* turbopackIgnore: true */ rateStatePath, 'utf8'));
      const lastRequestAt = readTimestamp(data.lastRequestAt);
      // Pre-scheduler files recorded only one request timestamp. Conservatively
      // treat it as the last parse too, so a restart cannot shorten parse pacing.
      const lastParseAt = readTimestamp(data.lastParseAt, lastRequestAt);
      const blockedUntil = readTimestamp(data.blockedUntil);
      state.lastRequestAt = lastRequestAt;
      state.lastParseAt = lastParseAt;
      state.blockedUntil = blockedUntil;
    } catch {
      // Missing or invalid state leaves the current values intact. On the first
      // run they are zero; after startup this avoids weakening in-memory pacing.
    }
  }

  function saveRateState() {
    try {
      state.lastRequestAt = validTimestamp(state.lastRequestAt);
      state.lastParseAt = validTimestamp(state.lastParseAt);
      state.blockedUntil = validTimestamp(state.blockedUntil);
      fileSystem.mkdirSync(/* turbopackIgnore: true */ dirname(rateStatePath), { recursive: true });
      const temporaryPath = `${rateStatePath}.tmp`;
      fileSystem.writeFileSync(
        /* turbopackIgnore: true */ temporaryPath,
        JSON.stringify({
          lastRequestAt: state.lastRequestAt,
          lastParseAt: state.lastParseAt,
          blockedUntil: state.blockedUntil,
        }, null, 2),
      );
      fileSystem.renameSync(/* turbopackIgnore: true */ temporaryPath, rateStatePath);
    } catch (e) {
      log.debug(`[liquipedia] could not save rate state: ${e.message}`);
    }
  }

  function markRateLimited(durationMs) {
    loadRateState({ force: true });
    const duration = Math.max(0, Number(durationMs) || 0);
    state.blockedUntil = Math.max(state.blockedUntil, now() + duration);
    saveRateState();
  }

  return { rateState: state, loadRateState, saveRateState, markRateLimited };
}

const defaultStore = createRateStateStore();

export const { rateState, loadRateState, saveRateState, markRateLimited } = defaultStore;
