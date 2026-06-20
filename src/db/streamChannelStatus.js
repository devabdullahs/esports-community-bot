import { all, get, run } from './client.js';

// Live status per platform+handle, written by the stream-status poller and read by
// the web embeds. Keyed by platform+handle so multiple channel rows (same handle at
// different scopes) share one status.

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function hydrate(row) {
  if (!row) return null;
  return {
    platform: row.platform,
    handle: row.handle,
    isLive: Boolean(row.is_live),
    title: row.title || null,
    viewerCount: row.viewer_count == null ? null : Number(row.viewer_count),
    category: row.category || null,
    thumbnailUrl: row.thumbnail_url || null,
    startedAt: row.started_at == null ? null : Number(row.started_at),
    checkedAt: row.checked_at == null ? null : Number(row.checked_at),
    updatedAt: row.updated_at,
  };
}

// Upsert one channel's current status. Pass isLive:false (the default) to mark it
// offline — title/viewers/started are cleared so a stale live snapshot can't linger.
export async function upsertStreamStatus({
  platform,
  handle,
  isLive = false,
  title = null,
  viewerCount = null,
  category = null,
  thumbnailUrl = null,
  startedAt = null,
}) {
  const live = isLive ? 1 : 0;
  await run(
    `INSERT INTO stream_channel_status
       (platform, handle, is_live, title, viewer_count, category, thumbnail_url, started_at, checked_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (platform, handle) DO UPDATE SET
       is_live       = excluded.is_live,
       title         = excluded.title,
       viewer_count  = excluded.viewer_count,
       category      = excluded.category,
       thumbnail_url = excluded.thumbnail_url,
       started_at    = excluded.started_at,
       checked_at    = excluded.checked_at,
       updated_at    = excluded.updated_at`,
    [
      platform,
      handle,
      live,
      live ? title : null,
      live ? viewerCount : null,
      live ? category : null,
      live ? thumbnailUrl : null,
      live ? startedAt : null,
      nowSeconds(),
      nowText(),
    ],
  );
}

// Status for a set of {platform, handle} pairs, keyed `${platform}:${handle}`.
// (Used by the web embeds to decide which channels to render.)
export async function getStreamStatuses(pairs) {
  const result = new Map();
  if (!Array.isArray(pairs) || pairs.length === 0) return result;
  const params = [];
  const ors = pairs.map((p) => {
    params.push(p.platform, p.handle);
    return `(platform = $${params.length - 1} AND handle = $${params.length})`;
  });
  const rows = await all(`SELECT * FROM stream_channel_status WHERE ${ors.join(' OR ')}`, params);
  for (const row of rows) result.set(`${row.platform}:${row.handle}`, hydrate(row));
  return result;
}

export async function listLiveStreamStatuses() {
  return (await all('SELECT * FROM stream_channel_status WHERE is_live = 1 ORDER BY viewer_count DESC NULLS LAST')).map(
    hydrate,
  );
}

export async function getStreamStatus(platform, handle) {
  return hydrate(await get('SELECT * FROM stream_channel_status WHERE platform = $1 AND handle = $2', [platform, handle]));
}

// Channels that haven't been polled within maxAgeSeconds (e.g. removed from the
// registry, so the poller stopped checking them) are forced offline so the embeds
// stop showing them as live.
export async function markStaleStatusesOffline(maxAgeSeconds) {
  const cutoff = nowSeconds() - maxAgeSeconds;
  const info = await run(
    `UPDATE stream_channel_status
       SET is_live = 0, title = NULL, viewer_count = NULL, category = NULL,
           thumbnail_url = NULL, started_at = NULL, updated_at = $1
     WHERE is_live = 1 AND (checked_at IS NULL OR checked_at < $2)`,
    [nowText(), cutoff],
  );
  return info.changes || 0;
}
