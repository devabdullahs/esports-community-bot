import { get, run } from './client.js';

function nowText(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function hydrate(row) {
  if (!row) return null;
  return {
    creatorKey: row.creator_key,
    announcedAt: row.announced_at == null ? null : Number(row.announced_at),
    platform: row.platform || null,
    handle: row.handle || null,
    title: row.title || null,
    liveStartedAt: row.live_started_at == null ? null : Number(row.live_started_at),
    liveVideoId: row.live_video_id || null,
    updatedAt: row.updated_at,
  };
}

export async function getStreamCreatorAnnouncement(creatorKey) {
  const key = String(creatorKey ?? '').trim();
  if (!key) return null;
  return hydrate(await get('SELECT * FROM stream_creator_announce_state WHERE creator_key = $1', [key]));
}

// Claim before Discord I/O. One concurrent caller wins, including across processes.
// Keep the claim after an ambiguous send failure: retrying can duplicate a delivered ping.
export async function claimStreamCreatorAnnouncement({
  creatorKey,
  announcedAt = Math.floor(Date.now() / 1000),
  platform = null,
  handle = null,
  title = null,
  liveStartedAt = null,
  liveVideoId = null,
  cooldownSeconds = 1800,
  crossPlatformSeconds = 21600,
}) {
  const key = String(creatorKey ?? '').trim();
  if (!key) return false;
  const at = Number(announcedAt) || Math.floor(Date.now() / 1000);
  const result = await run(
    `INSERT INTO stream_creator_announce_state
       (creator_key, announced_at, platform, handle, title, live_started_at, updated_at, live_video_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (creator_key) DO UPDATE SET
       announced_at    = excluded.announced_at,
       platform        = excluded.platform,
       handle          = excluded.handle,
       title           = excluded.title,
       live_started_at = excluded.live_started_at,
       live_video_id   = excluded.live_video_id,
       updated_at      = excluded.updated_at
     WHERE stream_creator_announce_state.announced_at <= excluded.announced_at -
       CASE WHEN COALESCE(stream_creator_announce_state.platform, '') <> COALESCE(excluded.platform, '') THEN $9 ELSE $10 END
       AND NOT (
         COALESCE(stream_creator_announce_state.platform, '') = COALESCE(excluded.platform, '')
         AND COALESCE(stream_creator_announce_state.handle, '') = COALESCE(excluded.handle, '')
         AND (
           (COALESCE(excluded.live_started_at, 0) > 0 AND COALESCE(stream_creator_announce_state.live_started_at, 0) = COALESCE(excluded.live_started_at, 0))
           OR (COALESCE(excluded.live_video_id, '') <> '' AND COALESCE(stream_creator_announce_state.live_video_id, '') = COALESCE(excluded.live_video_id, ''))
         )
       )`,
    [
      key,
      at,
      platform,
      handle,
      title,
      liveStartedAt == null ? null : Number(liveStartedAt),
      nowText(at),
      liveVideoId || null,
      crossPlatformSeconds,
      cooldownSeconds,
    ],
  );
  return Number(result.changes) === 1;
}
