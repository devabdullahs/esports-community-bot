import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// LiquipediaDB (LPDB) API v3 — structured match data (cleaner + higher limits than HTML parsing).
// REQUIRES an approved API key (https://liquipedia.net/api-terms-of-use → LiquipediaDB API).
// ToS: ≤ 60 requests / hour. We enforce ~1 request / 65s + a 5-minute cache.
//
// This client is DORMANT until LPDB_API_KEY is set. When it is, liquipedia.fetchSchedule()
// prefers it and falls back to HTML parsing on any error, so enabling it can't break the bot.
//
// ⚠️ The exact condition syntax / field names below are based on public docs and may need a
// small tweak once you can see the LiquipediaDB Dashboard (available after your key is approved).
const MIN_GAP_MS = 65_000;
const CACHE_TTL_MS = 5 * 60_000;

const client = axios.create({
  baseURL: config.lpdb.baseUrl,
  timeout: 20_000,
  headers: {
    'User-Agent': config.liquipedia.userAgent,
    'Accept-Encoding': 'gzip',
    ...(config.lpdb.apiKey ? { Authorization: `Apikey ${config.lpdb.apiKey}` } : {}),
  },
});

let lastAt = 0;
const cache = new Map();
const nowSec = () => Math.floor(Date.now() / 1000);

export function isEnabled() {
  return Boolean(config.lpdb.apiKey);
}

async function throttle() {
  const wait = lastAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
}

async function queryMatches(wiki, conditions) {
  const key = `${wiki}|${conditions}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  await throttle();
  const { data } = await client.get('/match', {
    params: { wiki, conditions, limit: 200, order: 'date ASC' },
  });
  const result = data?.result ?? data?.[0]?.result ?? [];
  cache.set(key, { at: Date.now(), data: result });
  return result;
}

function toSec(dateStr) {
  if (!dateStr || /^0000/.test(dateStr)) return null;
  const t = Date.parse(dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

// Normalize an LPDB match2 record into the bot's standard match shape.
export function normalize(m, wiki) {
  const opps = m.match2opponents || [];
  const nameOf = (o) => (o?.name || o?.template || 'TBD').replace(/_/g, ' ').trim();
  const scoreOf = (o) => {
    const s = Number(o?.score);
    return Number.isFinite(s) && s >= 0 ? s : null;
  };
  const teamA = nameOf(opps[0]);
  const teamB = nameOf(opps[1]);
  const scoreA = scoreOf(opps[0]);
  const scoreB = scoreOf(opps[1]);
  const scheduledAt = toSec(m.date);
  const finished = Number(m.finished) === 1;
  const winnerIdx = Number(m.winner);

  let status = 'scheduled';
  if (finished) status = 'finished';
  else if ((scoreA ?? 0) + (scoreB ?? 0) > 0) status = 'running';
  else if (scheduledAt && nowSec() >= scheduledAt && nowSec() - scheduledAt <= 4 * 3600) status = 'running';

  return {
    source: 'liquipedia',
    externalId: m.match2id || m.objectname || `lpdb:${wiki}:${teamA}:${teamB}:${scheduledAt}`,
    name: `${teamA} vs ${teamB}`,
    teamA,
    teamB,
    scoreA,
    scoreB,
    bestOf: Number(m.bestof) || null,
    scheduledAt,
    status,
    winner: finished && (winnerIdx === 1 || winnerIdx === 2) ? (winnerIdx === 1 ? teamA : teamB) : null,
  };
}

export function scheduleConditions(page) {
  const normalized = String(page || '').trim().replace(/^\/+|\/+$/g, '').replace(/ /g, '_');
  if (!normalized || /[\[\]\r\n]/.test(normalized)) return null;

  // Liquipedia stores tournament matches under the infobox `parent` value.
  // `pagename` only describes the page where a particular match widget was
  // rendered, so querying it alone returns an incomplete schedule whenever a
  // stage is transcluded from a child page.
  return `[[parent::${normalized}]] OR [[pagename::${normalized}]]`;
}

// Matches for a tracked tournament via LPDB (external_id = "<wiki>/<Page_Path>").
export async function fetchSchedule(tournament) {
  const [wiki, ...rest] = tournament.external_id.split('/');
  const page = rest.join('/');
  if (!page) return [];
  const conditions = scheduleConditions(page);
  if (!conditions) return [];
  const rows = await queryMatches(wiki, conditions);
  const seen = new Set();
  return rows
    .map((m) => normalize(m, wiki))
    .filter((m) => (m.teamA !== 'TBD' || m.teamB !== 'TBD') && !seen.has(m.externalId) && seen.add(m.externalId));
}
