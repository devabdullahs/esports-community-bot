import axios from 'axios';
import { logger } from './logger.js';

// Persistent backing store for the logo cache. The on-disk cache
// (data/logo-cache) lives in the container's ephemeral filesystem and is wiped
// on every deploy/restart; R2 (S3-compatible object storage) survives, so the
// local disk becomes a hot cache that refills from R2 on demand instead of
// re-downloading every crest from Liquipedia after each deploy.
//
// Reads go through the PUBLIC bucket URL (CDN-fronted, no auth, free egress);
// writes use the S3 API (R2 rejects chunked-transfer fetch PUTs with 411, so the
// AWS SDK is required to set Content-Length — lazy-loaded so non-R2 deployments
// never import it). When R2 is unconfigured (dev/tests) every function no-ops
// and the cache behaves exactly as local-only.

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || '';

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
const PUBLIC_BASE_URL = normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL);

// Distinct key prefix so the logo cache never collides with other assets in a
// shared bucket (the configured bucket may be reused across projects).
const KEY_PREFIX = String(process.env.R2_LOGO_PREFIX || 'esports-logo-cache').replace(/^\/+|\/+$/g, '');

const READ_TIMEOUT_MS = 8000;
const MAX_LOGO_BYTES = Math.max(64_000, Number(process.env.LOGO_MAX_BYTES || 4 * 1024 * 1024));

export function isR2Configured() {
  return Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && PUBLIC_BASE_URL);
}

export function r2LogoKey(hash) {
  return `${KEY_PREFIX}/${hash}`;
}

// Fetch cached logo bytes from R2's public URL. Returns a Buffer or null (miss,
// not configured, or any error). Never throws — a cold R2 must not break serving.
export async function r2GetLogo(hash) {
  if (!isR2Configured() || !hash) return null;
  const url = `${PUBLIC_BASE_URL}/${r2LogoKey(hash)}`;
  try {
    const { data } = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: READ_TIMEOUT_MS,
      maxContentLength: MAX_LOGO_BYTES,
    });
    return Buffer.from(data);
  } catch (e) {
    if (e.response?.status !== 404) logger.debug(`[r2] logo read failed (${hash}): ${e.message}`);
    return null;
  }
}

let s3client = null;
async function s3() {
  if (!s3client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return s3client;
}

// Persist logo bytes to R2. Returns true on success, false when unconfigured or
// on any error (best-effort — a failed upload just means the next reader
// re-downloads and re-uploads). Never throws.
export async function r2PutLogo(hash, bytes, contentType) {
  if (!isR2Configured() || !hash) return false;
  try {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await (await s3()).send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: r2LogoKey(hash),
        Body: body,
        ContentType: contentType || 'image/png',
        ContentLength: body.byteLength,
        // Cache hard at the edge: the key is a content hash, so bytes never change.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return true;
  } catch (e) {
    logger.debug(`[r2] logo write failed (${hash}): ${e.message}`);
    return false;
  }
}
