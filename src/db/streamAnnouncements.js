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
    updatedAt: row.updated_at,
  };
}

export async function getStreamCreatorAnnouncement(creatorKey) {
  const key = String(creatorKey ?? '').trim();
  if (!key) return null;
  return hydrate(await get('SELECT * FROM stream_creator_announce_state WHERE creator_key = $1', [key]));
}

export async function recordStreamCreatorAnnouncement({
  creatorKey,
  announcedAt = Math.floor(Date.now() / 1000),
  platform = null,
  handle = null,
  title = null,
  liveStartedAt = null,
}) {
  const key = String(creatorKey ?? '').trim();
  if (!key) return;
  const at = Number(announcedAt) || Math.floor(Date.now() / 1000);
  await run(
    `INSERT INTO stream_creator_announce_state
       (creator_key, announced_at, platform, handle, title, live_started_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (creator_key) DO UPDATE SET
       announced_at    = excluded.announced_at,
       platform        = excluded.platform,
       handle          = excluded.handle,
       title           = excluded.title,
       live_started_at = excluded.live_started_at,
       updated_at      = excluded.updated_at`,
    [
      key,
      at,
      platform,
      handle,
      title,
      liveStartedAt == null ? null : Number(liveStartedAt),
      nowText(at),
    ],
  );
}
