import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import axios from 'axios';
import { logger } from './logger.js';
import { r2GetLogo, r2PutLogo } from './r2Storage.js';

const http = axios.create({
  headers: {
    'User-Agent': process.env.LIQUIPEDIA_USER_AGENT || 'EsportsCommunityBot/0.1 (set LIQUIPEDIA_USER_AGENT with a contact email)',
    'Accept-Encoding': 'gzip',
  },
});

const CACHE_DIR = process.env.LOGO_CACHE_DIR || join(/* turbopackIgnore: true */ process.cwd(), 'data', 'logo-cache');
// Keep logo downloads strictly serial. These are non-critical and share the
// same upstream/IP budget as MediaWiki requests, so concurrency is not worth it.
const MAX_CONCURRENT_DOWNLOADS = 1;
const DOWNLOAD_MIN_GAP_MS = Math.max(10_000, Number(process.env.LOGO_DOWNLOAD_MIN_GAP_MS || 10_000));
const RATE_LIMIT_BACKOFF_MS = Math.max(60_000, Number(process.env.LOGO_RATE_LIMIT_BACKOFF_MS || 20 * 60_000));
const MAX_LOGO_BYTES = Math.max(64_000, Number(process.env.LOGO_MAX_BYTES || 4 * 1024 * 1024));
const RATE_STATE_PATH = process.env.LOGO_RATE_STATE_PATH || join(/* turbopackIgnore: true */ process.cwd(), 'data', 'logo-rate-limit.json');

const ALLOWED_LOGO_HOSTS = new Set(['liquipedia.net']);

const queue = [];
let activeDownloads = 0;

// Logo downloads run on independent rate-limit "channels". The bot's bulk
// canvas downloads can trip a long backoff on boot (resuming dozens of match
// cards at once); without isolation that same backoff would block the website's
// on-demand logo proxy, so every deploy left the dashboard showing fallbacks for
// ~20 min. Each channel keeps its own in-memory + persisted backoff state and
// shares only the on-disk image cache (keyed by URL), so a logo fetched by
// either side serves both.
const channels = new Map();
let liquipediaRateStatePromise = null;

async function liquipediaRateHelpers() {
  liquipediaRateStatePromise ||= import('../services/liquipedia/rateState.js').catch((e) => {
    logger.debug(`[logo-cache] liquipedia rate state unavailable: ${e.message}`);
    return null;
  });
  return liquipediaRateStatePromise;
}

async function liquipediaBlockedUntil() {
  const helpers = await liquipediaRateHelpers();
  if (!helpers) return 0;
  helpers.loadRateState({ force: true });
  return Number(helpers.rateState?.blockedUntil) || 0;
}

async function markLiquipediaBackoff(durationMs) {
  const helpers = await liquipediaRateHelpers();
  helpers?.markRateLimited(durationMs);
}

function channelState(name) {
  let state = channels.get(name);
  if (!state) {
    const statePath =
      name === 'bot'
        ? RATE_STATE_PATH
        : process.env[`LOGO_RATE_STATE_PATH_${name.toUpperCase()}`] ||
          join(/* turbopackIgnore: true */ dirname(RATE_STATE_PATH), `logo-rate-limit-${name}.json`);
    state = { lastDownloadAt: 0, blockedUntil: 0, loaded: false, statePath };
    channels.set(name, state);
  }
  return state;
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

mkdirSync(CACHE_DIR, { recursive: true });

export function isAllowedLogoUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_LOGO_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Re-apply the https + allowed-host policy to each redirect hop so a redirect
// from an allowed host cannot escape the allowlist to an internal/external
// address (SSRF). Mirrors isAllowedLogoUrl but works on axios redirect options.
export function isAllowedLogoRedirect(options) {
  const protocol = String(options?.protocol || '').toLowerCase();
  const hostname = String(options?.hostname || '').toLowerCase();
  return protocol === 'https:' && ALLOWED_LOGO_HOSTS.has(hostname);
}

export function rasterLogoContentType(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';

  const gif = buffer.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';

  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

export function logoCandidates(url) {
  const original = String(url).trim();
  const variants = [];
  const add = (candidate) => {
    if (candidate && !variants.includes(candidate)) variants.push(candidate);
  };
  const fileNameOf = (candidate) => decodeURIComponent(String(candidate).split(/[?#]/)[0].split('/').pop() || '');
  const redirectFor = (fileName) =>
    fileName ? `https://liquipedia.net/commons/Special:Redirect/file/${encodeURIComponent(fileName)}` : null;
  const addModeVariants = (candidate) => {
    const fileName = fileNameOf(candidate);
    if (/_lightmode(?=\.[a-z0-9]+$)/i.test(fileName)) {
      const darkFile = fileName.replace(/_lightmode(?=\.[a-z0-9]+$)/i, '_darkmode');
      const allFile = fileName.replace(/_lightmode(?=\.[a-z0-9]+$)/i, '_allmode');
      add(redirectFor(darkFile));
      add(redirectFor(allFile));
      add(candidate.replace(/_lightmode(?=\.[a-z0-9]+(?:[/?#]|$))/gi, '_darkmode'));
      add(candidate.replace(/_lightmode(?=\.[a-z0-9]+(?:[/?#]|$))/gi, '_allmode'));
    }
    add(candidate);
  };

  const m = original.match(
    /^(https:\/\/liquipedia\.net\/commons\/images)\/thumb\/([^/]+\/[^/]+\/[^/]+)\/\d+px-[^/?#]+([?#].*)?$/i,
  );
  if (!m) {
    addModeVariants(original);
    return variants;
  }

  const full = `${m[1]}/${m[2]}${m[3] || ''}`;
  addModeVariants(full);
  addModeVariants(original);
  return variants;
}

function loadRateState(state, { force = false } = {}) {
  if (state.loaded && !force) return;
  state.loaded = true;
  try {
    const data = JSON.parse(readFileSync(state.statePath, 'utf8'));
    state.lastDownloadAt = Number(data.lastDownloadAt) || 0;
    state.blockedUntil = Number(data.blockedUntil) || 0;
  } catch {
    // Missing or invalid state just means this is the first run.
  }
}

function saveRateState(state) {
  try {
    mkdirSync(dirname(state.statePath), { recursive: true });
    writeFileSync(state.statePath, JSON.stringify({ lastDownloadAt: state.lastDownloadAt, blockedUntil: state.blockedUntil }, null, 2));
  } catch (e) {
    logger.debug(`[logo-cache] could not save rate state: ${e.message}`);
  }
}

function logoHash(url) {
  return createHash('sha256').update(url).digest('hex');
}

function logoPath(url) {
  return join(CACHE_DIR, `${logoHash(url)}.img`);
}

function runLimited(fn) {
  return new Promise((resolvePromise, reject) => {
    queue.push({ fn, resolve: resolvePromise, reject });
    pumpQueue();
  });
}

function pumpQueue() {
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && queue.length) {
    const job = queue.shift();
    activeDownloads++;
    job
      .fn()
      .then(job.resolve, job.reject)
      .finally(() => {
        activeDownloads--;
        pumpQueue();
      });
  }
}

async function readCached(file) {
  try {
    const bytes = await readFile(file);
    if (rasterLogoContentType(bytes)) return bytes;
    await unlink(file).catch(() => {});
    logger.debug(`[logo-cache] discarded non-raster cached logo (${file})`);
    return null;
  } catch (e) {
    if (e.code !== 'ENOENT') logger.debug(`[logo-cache] read failed (${file}): ${e.message}`);
    return null;
  }
}

async function downloadLogo(url, file, channel) {
  const state = channelState(channel);
  const globalState = channelState('global');
  await waitForLogoSlot(state, globalState);

  const { data, headers } = await http.get(url, {
    responseType: 'arraybuffer',
    timeout: 10_000,
    maxContentLength: MAX_LOGO_BYTES,
    maxRedirects: 3,
    beforeRedirect: (options) => {
      if (!isAllowedLogoRedirect(options)) {
        throw new Error('logo redirect to a disallowed host blocked');
      }
    },
  }).catch(async (err) => {
    const status = err.response?.status;
    if (status === 403 || status === 429 || status === 503) {
      state.blockedUntil = Math.max(state.blockedUntil, Date.now() + RATE_LIMIT_BACKOFF_MS);
      const globalState = channelState('global');
      loadRateState(globalState, { force: true });
      globalState.blockedUntil = Math.max(globalState.blockedUntil, state.blockedUntil);
      saveRateState(state);
      saveRateState(globalState);
      await markLiquipediaBackoff(RATE_LIMIT_BACKOFF_MS);
      logger.warn(`[logo-cache:${channel}] rate limited (HTTP ${status}) - pausing logo downloads for ${Math.round(RATE_LIMIT_BACKOFF_MS / 60000)} min`);
    }
    throw err;
  });
  const type = String(headers?.['content-type'] || '');
  if (type && !type.startsWith('image/')) throw new Error(`unexpected content-type ${type}`);

  const bytes = Buffer.from(data);
  if (bytes.length > MAX_LOGO_BYTES) throw new Error(`logo too large (${bytes.length} bytes)`);
  const rasterType = rasterLogoContentType(bytes);
  if (!rasterType) throw new Error('unexpected logo image format');
  await writeFile(file, bytes);
  // Persist to R2 so this crest survives the next container wipe (best-effort).
  await r2PutLogo(logoHash(url), bytes, rasterType);
  return bytes;
}

async function waitForLogoSlot(state, globalState) {
  for (;;) {
    loadRateState(state, { force: true });
    loadRateState(globalState, { force: true });
    const blockedUntil = Math.max(state.blockedUntil, globalState.blockedUntil, await liquipediaBlockedUntil());
    if (Date.now() < blockedUntil) throw new Error('logo downloads backing off after a rate limit');

    const wait = Math.max(state.lastDownloadAt, globalState.lastDownloadAt) + DOWNLOAD_MIN_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }

  const now = Date.now();
  state.lastDownloadAt = now;
  globalState.lastDownloadAt = now;
  saveRateState(state);
  saveRateState(globalState);
}

export async function fetchLogoBytes(url, channel = 'bot', { download = true } = {}) {
  const file = logoPath(url);
  const cached = await readCached(file);
  if (cached) return { bytes: cached, file, cached: true };

  // Persistent R2 layer: after a deploy wipes the local disk cache, serve from
  // R2 (our own storage/CDN — not Liquipedia, so no rate limit and allowed even
  // when download=false) and refill the local hot cache. This is what stops the
  // whole site from falling back to initials for hours after every deploy.
  const fromR2 = await r2GetLogo(logoHash(url));
  if (fromR2 && rasterLogoContentType(fromR2)) {
    await writeFile(file, fromR2).catch(() => {});
    return { bytes: fromR2, file, cached: true };
  }

  if (!download) return null;

  const bytes = await runLimited(async () => {
    const afterQueue = await readCached(file);
    return afterQueue || downloadLogo(url, file, channel);
  });
  return { bytes, file, cached: false };
}

export async function refreshLogoBytes(url, file, channel = 'bot') {
  return runLimited(() => downloadLogo(url, file, channel));
}

export async function loadLogoBytes(url, channel = 'bot', options = {}) {
  if (!url || !isAllowedLogoUrl(url)) return null;
  for (const candidate of logoCandidates(url)) {
    try {
      const logo = await fetchLogoBytes(candidate, channel, options);
      if (logo) return logo;
    } catch (e) {
      logger.debug(`[logo-cache] byte candidate failed (${candidate}): ${e.message}`);
    }
  }
  return null;
}

export function logoSourceStats() {
  return {
    queuedDownloads: queue.length,
    activeDownloads,
    cacheDir: CACHE_DIR,
  };
}
