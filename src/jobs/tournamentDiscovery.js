import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { parsePage } from '../services/liquipedia/client.js';
import { parseTournamentDiscovery } from '../services/liquipedia/discoveryParsers.js';
import { listDiscoveryGames, hasDiscoveredTournament } from '../db/tournamentDiscovery.js';
import { enqueueTournamentOperation } from '../db/tournamentOperations.js';

export function discoveryOperation(guildId, identity) {
  return {
    operation: 'validate_and_activate', source: 'liquipedia', sourceId: identity.sourceId,
    game: identity.game, guildId, requestedActorType: 'system', requestedActorName: 'Tournament discovery',
    idempotencyKey: `discovery:${createHash('sha256').update(`${guildId}:${identity.sourceId}`).digest('hex')}`,
  };
}

export async function queueDiscoveredTournaments(guildId, candidates, {
  exists = hasDiscoveredTournament, enqueue = enqueueTournamentOperation,
} = {}) {
  let queued = 0;
  for (const identity of candidates) {
    if (await exists(guildId, identity)) continue;
    const result = await enqueue(discoveryOperation(guildId, identity));
    if (result.created) queued++;
  }
  return queued;
}

const STATE_PATH = join(/* turbopackIgnore: true */ process.cwd(), 'data', 'tournament-discovery.json');
const INTERVAL_MS = 5 * 60_000;
const RESCAN_MS = 6 * 3600_000;
let timer = null;
let running = false;
let stopped = false;

export async function runTournamentDiscovery() {
  if (running || stopped || !config.discord.guildId) return;
  running = true;
  try {
    const guildId = config.discord.guildId;
    const games = await listDiscoveryGames(guildId);
    let state = {};
    try { state = JSON.parse(await readFile(STATE_PATH, 'utf8')); } catch { /* first run */ }
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
    const key = [...games].sort((a, b) => (Number(state[a]) || 0) - (Number(state[b]) || 0)).find(game => Date.now() - (Number(state[game]) || 0) >= RESCAN_MS);
    if (!key || stopped) return;
    const game = key;
    const page = 'Main_Page';
    try {
      const parsed = await parsePage(game, page);
      if (stopped) return;
      const html = parsed.parse?.text?.['*'];
      if (typeof html !== 'string') throw new Error('Main page returned no parsed HTML');
      const result = parseTournamentDiscovery(html, game);
      const queued = await queueDiscoveredTournaments(guildId, result.candidates);
      logger.info(`[tournament-discovery] ${key}: ${result.candidates.length} eligible, ${result.unknownTier} without tier, ${queued} validation(s) queued`);
    } catch (error) {
      logger.warn(`[tournament-discovery] ${key}: ${error.message}`);
    }
    // Rotate after failures too, so an unsupported wiki layout cannot starve other games.
    state[key] = Date.now();
    state = Object.fromEntries(Object.entries(state).filter(([game]) => games.includes(game)));
    await mkdir(dirname(STATE_PATH), { recursive: true });
    await writeFile(`${STATE_PATH}.tmp`, JSON.stringify(state));
    await rename(`${STATE_PATH}.tmp`, STATE_PATH);
  } finally { running = false; }
}

export function startTournamentDiscovery() {
  if (timer || process.env.TOURNAMENT_DISCOVERY_ENABLED === 'false') return;
  stopped = false;
  timer = setInterval(() => void runTournamentDiscovery().catch(error => logger.error(`[tournament-discovery] ${error.message}`)), INTERVAL_MS);
  timer.unref?.();
}

export function stopTournamentDiscovery() {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}
