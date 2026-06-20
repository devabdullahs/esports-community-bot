import axios from 'axios';
import { config } from '../config.js';

// Kick live-status lookups. App-only (client_credentials). Docs: https://docs.kick.com
// GET /public/v1/channels?slug=... returns each channel with a `stream.is_live` flag.
const TOKEN_URL = 'https://id.kick.com/oauth/token';
const API = 'https://api.kick.com/public/v1';
const BATCH = 50; // channels endpoint accepts up to 50 slugs per call.

const http = axios.create({ timeout: 12_000 });

let tokenCache = { token: null, expiresAt: 0 };

export function isConfigured() {
  return Boolean(config.kick.clientId && config.kick.clientSecret);
}

export function resetTokenCache() {
  tokenCache = { token: null, expiresAt: 0 };
}

export async function getAppToken({ client = http, now = Date.now } = {}) {
  if (tokenCache.token && tokenCache.expiresAt > now() + 60_000) return tokenCache.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.kick.clientId,
    client_secret: config.kick.clientSecret,
  });
  const { data } = await client.post(TOKEN_URL, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!data?.access_token) throw new Error('Kick token response had no access_token');
  tokenCache = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

function normalizeChannel(c) {
  const stream = c.stream || {};
  return {
    isLive: Boolean(stream.is_live),
    title: stream.stream_title || null,
    viewerCount: stream.viewer_count == null ? null : Number(stream.viewer_count),
    category: c.category?.name || stream.category?.name || null,
    startedAt: stream.start_time ? Math.floor(new Date(stream.start_time).getTime() / 1000) : null,
    thumbnailUrl: stream.thumbnail || c.stream_thumbnail || null,
  };
}

async function fetchBatch(slugs, client, token) {
  const params = new URLSearchParams();
  for (const slug of slugs) params.append('slug', slug);
  const { data } = await client.get(`${API}/channels?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data?.data ?? [];
}

// Map of slug (lowercased) -> live info for the requested channels. Unlike Twitch,
// Kick returns offline channels too (with is_live false). `client` injectable for tests.
export async function getLiveChannels(slugs, { client = http } = {}) {
  const result = new Map();
  if (!isConfigured() || !slugs.length) return result;

  let token = await getAppToken({ client });
  for (let i = 0; i < slugs.length; i += BATCH) {
    const batch = slugs.slice(i, i + BATCH);
    let channels;
    try {
      channels = await fetchBatch(batch, client, token);
    } catch (e) {
      if (e?.response?.status === 401) {
        resetTokenCache();
        token = await getAppToken({ client });
        channels = await fetchBatch(batch, client, token);
      } else {
        throw e;
      }
    }
    for (const c of channels) {
      const slug = String(c.slug || '').toLowerCase();
      if (slug) result.set(slug, normalizeChannel(c));
    }
  }
  return result;
}
