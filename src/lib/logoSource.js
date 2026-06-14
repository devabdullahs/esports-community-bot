import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import axios from 'axios';
import { logger } from './logger.js';

const http = axios.create({
  headers: {
    'User-Agent': process.env.LIQUIPEDIA_USER_AGENT || 'EsportsCommunityBot/0.1 (set LIQUIPEDIA_USER_AGENT with a contact email)',
    'Accept-Encoding': 'gzip',
  },
});

const CACHE_DIR = process.env.LOGO_CACHE_DIR || join(/* turbopackIgnore: true */ process.cwd(), 'data', 'logo-cache');
const MAX_CONCURRENT_DOWNLOADS = Math.max(1, Number(process.env.LOGO_CACHE_CONCURRENCY || 2));
const DOWNLOAD_MIN_GAP_MS = Math.max(0, Number(process.env.LOGO_DOWNLOAD_MIN_GAP_MS || 2000));
const RATE_LIMIT_BACKOFF_MS = Math.max(60_000, Number(process.env.LOGO_RATE_LIMIT_BACKOFF_MS || 20 * 60_000));
const MAX_LOGO_BYTES = Math.max(64_000, Number(process.env.LOGO_MAX_BYTES || 4 * 1024 * 1024));
const RATE_STATE_PATH = process.env.LOGO_RATE_STATE_PATH || join(/* turbopackIgnore: true */ process.cwd(), 'data', 'logo-rate-limit.json');

const ALLOWED_LOGO_HOSTS = new Set(['liquipedia.net']);

const queue = [];
let activeDownloads = 0;
let lastDownloadAt = 0;
let blockedUntil = 0;
let rateStateLoaded = false;

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

function loadRateState() {
  if (rateStateLoaded) return;
  rateStateLoaded = true;
  try {
    const data = JSON.parse(readFileSync(RATE_STATE_PATH, 'utf8'));
    lastDownloadAt = Number(data.lastDownloadAt) || 0;
    blockedUntil = Number(data.blockedUntil) || 0;
  } catch {
    // Missing or invalid state just means this is the first run.
  }
}

function saveRateState() {
  try {
    mkdirSync(dirname(RATE_STATE_PATH), { recursive: true });
    writeFileSync(RATE_STATE_PATH, JSON.stringify({ lastDownloadAt, blockedUntil }, null, 2));
  } catch (e) {
    logger.debug(`[logo-cache] could not save rate state: ${e.message}`);
  }
}

function logoPath(url) {
  const key = createHash('sha256').update(url).digest('hex');
  return join(CACHE_DIR, `${key}.img`);
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
    return await readFile(file);
  } catch (e) {
    if (e.code !== 'ENOENT') logger.debug(`[logo-cache] read failed (${file}): ${e.message}`);
    return null;
  }
}

async function downloadLogo(url, file) {
  loadRateState();
  if (Date.now() < blockedUntil) throw new Error('logo downloads backing off after a rate limit');
  const wait = lastDownloadAt + DOWNLOAD_MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastDownloadAt = Date.now();
  saveRateState();

  const { data, headers } = await http.get(url, {
    responseType: 'arraybuffer',
    timeout: 10_000,
    maxContentLength: MAX_LOGO_BYTES,
  }).catch((err) => {
    const status = err.response?.status;
    if (status === 403 || status === 429 || status === 503) {
      blockedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      saveRateState();
      logger.warn(`[logo-cache] rate limited (HTTP ${status}) - pausing logo downloads for ${Math.round(RATE_LIMIT_BACKOFF_MS / 60000)} min`);
    }
    throw err;
  });
  const type = String(headers?.['content-type'] || '');
  if (type && !type.startsWith('image/')) throw new Error(`unexpected content-type ${type}`);

  const bytes = Buffer.from(data);
  if (bytes.length > MAX_LOGO_BYTES) throw new Error(`logo too large (${bytes.length} bytes)`);
  await writeFile(file, bytes);
  return bytes;
}

export async function fetchLogoBytes(url) {
  const file = logoPath(url);
  const cached = await readCached(file);
  if (cached) return { bytes: cached, file, cached: true };

  const bytes = await runLimited(async () => {
    const afterQueue = await readCached(file);
    return afterQueue || downloadLogo(url, file);
  });
  return { bytes, file, cached: false };
}

export async function refreshLogoBytes(url, file) {
  return runLimited(() => downloadLogo(url, file));
}

export async function loadLogoBytes(url) {
  if (!url || !isAllowedLogoUrl(url)) return null;
  for (const candidate of logoCandidates(url)) {
    try {
      return await fetchLogoBytes(candidate);
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
