-- Persist YouTube broadcast identity alongside Twitch/Kick start times.
ALTER TABLE stream_creator_announce_state ADD COLUMN IF NOT EXISTS live_video_id TEXT;
