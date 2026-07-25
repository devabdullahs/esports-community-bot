import { randomUUID } from 'node:crypto';

try {
  process.loadEnvFile();
} catch {
  // The container can provide configuration directly through its environment.
}

const AUTH_HEADER = 'x-ewc-internal-secret';
const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_TIMEOUT_MS = 5_000;
const RESPONSE_MAX_BYTES = 32 * 1024;
const MIN_SECRET_LENGTH = 32;

const ROUTES = Object.freeze({
  profileSync: '/api/internal/ewc-profile/sync',
  newsRevalidate: '/api/internal/news/revalidate',
});

function configurationError() {
  return new Error('Dashboard internal capabilities are misconfigured.');
}

function validSecret(value) {
  if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return false;
  if (value !== value.trim() || /[\x00-\x20\x7f]/.test(value)) return false;
  const normalized = value.trim().toLowerCase();
  return !normalized.includes('generate-') && !normalized.includes('change-me') && !normalized.includes('placeholder');
}

function parseInternalBase(rawValue) {
  const raw = String(rawValue || '').trim();
  const match = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})\/?$/.exec(raw);
  if (!match) throw configurationError();

  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw configurationError();

  const base = new URL(raw.endsWith('/') ? raw : `${raw}/`);
  if (
    base.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    || !base.port
    || base.pathname !== '/'
    || base.username
    || base.password
    || base.search
    || base.hash
  ) {
    throw configurationError();
  }
  return base;
}

function loadConfiguration() {
  const rawUrl = process.env.EWC_DASHBOARD_INTERNAL_URL;
  const profileSecret = process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET;
  const newsSecret = process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET;
  const configured = Boolean(rawUrl || profileSecret || newsSecret);
  if (!configured) return null;
  if (!rawUrl || !validSecret(profileSecret) || !validSecret(newsSecret)) throw configurationError();

  return Object.freeze({
    base: parseInternalBase(rawUrl),
    profileSecret,
    newsSecret,
  });
}

const configuration = loadConfiguration();

function operationTarget(pathname) {
  if (!configuration) return null;
  const target = new URL(pathname.slice(1), configuration.base);
  if (
    target.origin !== configuration.base.origin
    || target.pathname !== pathname
    || target.search
    || target.hash
    || target.username
    || target.password
  ) {
    throw configurationError();
  }
  return target;
}

async function boundedResponseBytes(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Dashboard internal response exceeded the allowed size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function request(pathname, secret, body) {
  const target = operationTarget(pathname);
  if (!target) return null;
  const requestId = randomUUID();
  let response;

  try {
    response = await fetch(target, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [AUTH_HEADER]: secret,
        [REQUEST_ID_HEADER]: requestId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'timed out'
      : 'could not be reached';
    throw new Error(`Dashboard internal operation ${reason} (request ${requestId}).`);
  }

  const bytes = await boundedResponseBytes(response);
  if (!response.ok) {
    throw new Error(`Dashboard internal operation failed with status ${response.status} (request ${requestId}).`);
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('invalid shape');
    return parsed;
  } catch {
    throw new Error(`Dashboard internal operation returned an invalid response (request ${requestId}).`);
  }
}

export async function syncDashboardProfile({ discordUserId, guildId, season }) {
  return request(
    ROUTES.profileSync,
    configuration?.profileSecret,
    { discordUserId, guildId, season },
  );
}

export async function revalidateDashboardNews() {
  return request(ROUTES.newsRevalidate, configuration?.newsSecret);
}
