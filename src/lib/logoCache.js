import { unlink } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { logger } from './logger.js';
import {
  fetchLogoBytes,
  isAllowedLogoUrl,
  logoCandidates,
  logoSourceStats,
  refreshLogoBytes,
} from './logoSource.js';

const FAILURE_TTL_MS = Math.max(60_000, Number(process.env.LOGO_FAILURE_TTL_MS || 15 * 60_000));

const images = new Map(); // url -> Image
const inFlight = new Map(); // url -> Promise<Image | null>
const failures = new Map(); // url -> retryAfterMs

async function loadBytesAsImage(url) {
  const first = await fetchLogoBytes(url);
  try {
    return await loadPreparedImage(url, first.bytes);
  } catch (e) {
    if (!first.cached) throw e;
    await unlink(first.file).catch(() => {});
    const fresh = await refreshLogoBytes(url, first.file);
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
  // Security boundary: refuse any URL outside the logo host allow-list before any
  // cache lookup or network request (the parser is upstream and less trusted).
  if (!isAllowedLogoUrl(url)) {
    logger.debug(`[logo-cache] refused logo URL outside allow-list (${url})`);
    return null;
  }
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
  const source = logoSourceStats();
  return {
    cachedImages: images.size,
    inFlight: inFlight.size,
    queuedDownloads: source.queuedDownloads,
    activeDownloads: source.activeDownloads,
    cacheDir: source.cacheDir,
  };
}

export { isAllowedLogoUrl };
