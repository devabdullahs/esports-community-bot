import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import axios from 'axios';
import { logger } from './logger.js';

const CACHE_DIR = resolve(process.env.LOGO_CACHE_DIR || 'data/logo-cache');
const MAX_CONCURRENT_DOWNLOADS = Math.max(1, Number(process.env.LOGO_CACHE_CONCURRENCY || 2));
const DOWNLOAD_MIN_GAP_MS = Math.max(0, Number(process.env.LOGO_DOWNLOAD_MIN_GAP_MS || 2000));
const FAILURE_TTL_MS = Math.max(60_000, Number(process.env.LOGO_FAILURE_TTL_MS || 15 * 60_000));
const RATE_LIMIT_BACKOFF_MS = Math.max(60_000, Number(process.env.LOGO_RATE_LIMIT_BACKOFF_MS || 20 * 60_000));
const MAX_LOGO_BYTES = Math.max(64_000, Number(process.env.LOGO_MAX_BYTES || 4 * 1024 * 1024));
const RATE_STATE_PATH = resolve(process.env.LOGO_RATE_STATE_PATH || 'data/logo-rate-limit.json');

mkdirSync(CACHE_DIR, { recursive: true });

const images = new Map(); // url -> Image
const inFlight = new Map(); // url -> Promise<Image | null>
const failures = new Map(); // url -> retryAfterMs
const queue = [];
let activeDownloads = 0;
let lastDownloadAt = 0;
let blockedUntil = 0;
let rateStateLoaded = false;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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

function logoCandidates(url) {
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

  const { data, headers } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 10_000,
    maxContentLength: MAX_LOGO_BYTES,
    headers: { 'User-Agent': 'EsportsCommunityBot/1.0 (Discord match cards; logo cache)' },
  }).catch((err) => {
    const status = err.response?.status;
    if (status === 403 || status === 429 || status === 503) {
      blockedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      saveRateState();
      logger.warn(`[logo-cache] rate limited (HTTP ${status}) — pausing logo downloads for ${Math.round(RATE_LIMIT_BACKOFF_MS / 60000)} min`);
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

async function getLogoBytes(url) {
  const file = logoPath(url);
  const cached = await readCached(file);
  if (cached) return { bytes: cached, file, cached: true };

  const bytes = await runLimited(async () => {
    const afterQueue = await readCached(file);
    return afterQueue || downloadLogo(url, file);
  });
  return { bytes, file, cached: false };
}

async function loadBytesAsImage(url) {
  const first = await getLogoBytes(url);
  try {
    return await loadPreparedImage(url, first.bytes);
  } catch (e) {
    if (!first.cached) throw e;
    await unlink(first.file).catch(() => {});
    const fresh = await runLimited(() => downloadLogo(url, first.file));
    return loadPreparedImage(url, fresh);
  }
}

async function loadPreparedImage(url, bytes) {
  const img = await loadImage(bytes);
  if (!/_lightmode(?=\.[a-z0-9]+(?:[/?#]|$))/i.test(url)) return img;

  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  let visible = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    const a = data.data[i + 3];
    if (a < 24) continue;
    visible++;
    const r = data.data[i];
    const g = data.data[i + 1];
    const b = data.data[i + 2];
    if (r < 82 && g < 82 && b < 82) dark++;
  }
  if (!visible || dark / visible < 0.18) return img;

  for (let i = 0; i < data.data.length; i += 4) {
    const a = data.data[i + 3];
    if (a < 24) continue;
    const r = data.data[i];
    const g = data.data[i + 1];
    const b = data.data[i + 2];
    if (r < 82 && g < 82 && b < 82) {
      data.data[i] = 245;
      data.data[i + 1] = 248;
      data.data[i + 2] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return loadImage(canvas.toBuffer('image/png'));
}

async function decodeLogo(candidates) {
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await loadBytesAsImage(candidate);
    } catch (e) {
      lastError = e;
      logger.debug(`[logo-cache] candidate failed (${candidate}): ${e.message}`);
    }
  }
  throw lastError || new Error('no logo candidates');
}

export async function loadLogoImage(url) {
  if (!url) return null;
  const candidates = logoCandidates(url);
  const key = candidates[0];
  const retryAfter = failures.get(key);
  if (retryAfter && retryAfter > Date.now()) return null;
  if (images.has(key)) return images.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = decodeLogo(candidates)
    .then((img) => {
      images.set(key, img);
      failures.delete(key);
      return img;
    })
    .catch((e) => {
      failures.set(key, Date.now() + FAILURE_TTL_MS);
      logger.debug(`[logo-cache] logo load failed (${url}): ${e.message}`);
      return null;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

export function logoCacheStats() {
  return {
    cachedImages: images.size,
    inFlight: inFlight.size,
    queuedDownloads: queue.length,
    activeDownloads,
    cacheDir: CACHE_DIR,
  };
}
