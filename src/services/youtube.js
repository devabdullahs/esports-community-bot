import axios from 'axios';
import { config } from '../config.js';

// YouTube live-status lookups WITHOUT API credentials. The official Data API
// prices live lookups at 100 quota units per search call — a handful of channels
// polled every few minutes would blow the daily quota — so instead we fetch the
// public `https://www.youtube.com/@handle/live` page, which redirects to the
// live watch page while (and only while) the channel is live:
//   - `"isLiveNow":true` in the embedded player response marks a CURRENT
//     broadcast (upcoming/scheduled streams carry isLiveNow:false).
//   - the canonical link carries the live VIDEO id, which is exactly what the
//     web needs to render a YouTube iframe embed.
// One request per channel, sequential with a gap, on a slower cadence than the
// Twitch/Kick API polls (see streams.youtubePollSeconds).
const REQUEST_GAP_MS = 1_000;
const MAX_BYTES = 3 * 1024 * 1024; // live watch pages run ~1-2MB

const http = axios.create({
  timeout: 12_000,
  maxContentLength: MAX_BYTES,
  headers: {
    // A browser-ish UA + english so the page shape stays predictable.
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EsportsCommunityBot/1.0',
    'Accept-Language': 'en',
  },
  validateStatus: (s) => s >= 200 && s < 500, // 404 = no such channel, handled below
});

export function isConfigured() {
  return config.streams.youtubeEnabled;
}

function channelLiveUrl(handle) {
  const clean = String(handle ?? '').trim().replace(/^@/, '');
  return `https://www.youtube.com/@${encodeURIComponent(clean)}/live`;
}

// Parse one /live page into the poller's status shape, or null when the fetch
// itself said nothing usable (caller treats null as offline).
export function parseLivePage(html) {
  const text = String(html ?? '');
  if (!text) return null;
  const isLive = /"isLiveNow"\s*:\s*true/.test(text);
  const canonical = text.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{6,20})"/);
  const videoId = canonical?.[1] ?? text.match(/"videoId"\s*:\s*"([\w-]{6,20})"/)?.[1] ?? null;
  const title =
    text.match(/<meta name="title" content="([^"]*)"/)?.[1] ??
    text.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ??
    null;
  // Rough concurrent viewers ("1,234 watching now" in the watch page metadata).
  const watching = text.match(/([\d,.]+)\s+watching now/);
  const viewerCount = watching ? Number(watching[1].replace(/[,.]/g, '')) || null : null;
  if (!isLive || !videoId) return { isLive: false };
  return {
    isLive: true,
    videoId,
    title: title ? decodeHtmlEntities(title) : null,
    viewerCount,
    // YouTube pages don't expose a start timestamp or a reliable game category
    // without the paid API — leave them null (relevance gating passes nulls).
    category: null,
    startedAt: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault_live.jpg`,
  };
}

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Live status for a list of @handles, keyed by the handle as passed in (matching
// twitch.getLiveStreams / kick.getLiveChannels). Sequential on purpose: this is
// a page fetch, not a batched API, so we keep it gentle.
export async function getLiveChannels(handles, { client = http, gapMs = REQUEST_GAP_MS } = {}) {
  const out = new Map();
  let first = true;
  for (const handle of handles ?? []) {
    if (!first) await sleep(gapMs);
    first = false;
    try {
      const { status, data } = await client.get(channelLiveUrl(handle));
      if (status !== 200) continue; // transient (429/5xx): keep previous status, don't flap
      const parsed = parseLivePage(data);
      out.set(handle, parsed?.isLive ? parsed : { isLive: false });
    } catch {
      // Network hiccup: report nothing for this handle so the poller keeps the
      // previous status instead of flapping a live embed offline.
    }
  }
  return out;
}
