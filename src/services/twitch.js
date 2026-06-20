import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Twitch Helix live-status lookups. App-only (client_credentials) — no user OAuth.
// Docs: https://dev.twitch.tv/docs/api/reference#get-streams
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';
const BATCH = 100; // Get Streams accepts up to 100 user_login per call.

const http = axios.create({ timeout: 12_000 });

let tokenCache = { token: null, expiresAt: 0 };

export function isConfigured() {
  return Boolean(config.twitch.clientId && config.twitch.clientSecret);
}

export function resetTokenCache() {
  tokenCache = { token: null, expiresAt: 0 };
}

// Cached app access token; refreshed ~1 min before expiry. `client` injectable for tests.
export async function getAppToken({ client = http, now = Date.now } = {}) {
  if (tokenCache.token && tokenCache.expiresAt > now() + 60_000) return tokenCache.token;
  const { data } = await client.post(TOKEN_URL, null, {
    params: {
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'client_credentials',
    },
  });
  if (!data?.access_token) throw new Error('Twitch token response had no access_token');
  tokenCache = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

function normalizeStream(s) {
  return {
    isLive: s.type === 'live',
    title: s.title ?? null,
    viewerCount: s.viewer_count == null ? null : Number(s.viewer_count),
    category: s.game_name || null,
    startedAt: s.started_at ? Math.floor(new Date(s.started_at).getTime() / 1000) : null,
    thumbnailUrl: s.thumbnail_url || null,
  };
}

async function fetchBatch(logins, client, token) {
  const params = new URLSearchParams();
  for (const login of logins) params.append('user_login', login);
  const { data } = await client.get(`${HELIX}/streams?${params.toString()}`, {
    headers: { 'Client-Id': config.twitch.clientId, Authorization: `Bearer ${token}` },
  });
  return data?.data ?? [];
}

// Map of login (lowercased) -> live info, ONLY for channels currently live. Logins
// absent from the result are offline. `client` injectable for tests (no network).
export async function getLiveStreams(logins, { client = http } = {}) {
  const result = new Map();
  if (!isConfigured() || !logins.length) return result;

  let token = await getAppToken({ client });
  for (let i = 0; i < logins.length; i += BATCH) {
    const batch = logins.slice(i, i + BATCH);
    let streams;
    try {
      streams = await fetchBatch(batch, client, token);
    } catch (e) {
      // A 401 means the token was revoked/expired early — refresh once and retry.
      if (e?.response?.status === 401) {
        resetTokenCache();
        token = await getAppToken({ client });
        streams = await fetchBatch(batch, client, token);
      } else {
        throw e;
      }
    }
    for (const s of streams) {
      const login = String(s.user_login || '').toLowerCase();
      if (login) result.set(login, normalizeStream(s));
    }
  }
  return result;
}
