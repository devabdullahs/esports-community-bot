import { db } from './index.js';

const CHANNEL_FIELDS = ['schedule_channel_id', 'voice_channel_id', 'leaderboard_channel_id', 'match_card_channel_id'];

export function getSettings(guildId) {
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) ?? {};
}

export function setChannel(guildId, field, channelId) {
  if (!CHANNEL_FIELDS.includes(field)) throw new Error(`Invalid settings field: ${field}`);
  // field is from a fixed allowlist above, so interpolation here is safe.
  db.prepare(
    `INSERT INTO guild_settings (guild_id, ${field}, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (guild_id) DO UPDATE SET ${field} = excluded.${field}, updated_at = datetime('now')`,
  ).run(guildId, channelId);
}

export function setAuditLogChannel(guildId, channelId) {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, audit_log_channel_id, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (guild_id) DO UPDATE SET audit_log_channel_id = excluded.audit_log_channel_id, updated_at = datetime('now')`,
  ).run(guildId, channelId);
}

export function setLeaderboardMessage(guildId, messageId) {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, leaderboard_message_id, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (guild_id) DO UPDATE SET leaderboard_message_id = excluded.leaderboard_message_id, updated_at = datetime('now')`,
  ).run(guildId, messageId);
}

// --- EWC Club Championship tracker (one per guild) ---

export function setClubChampionship(guildId, { wiki, page, channelId, label }) {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, cc_wiki, cc_page, cc_channel_id, cc_label, cc_message_id, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))
     ON CONFLICT (guild_id) DO UPDATE SET
       cc_wiki = excluded.cc_wiki,
       cc_page = excluded.cc_page,
       cc_channel_id = excluded.cc_channel_id,
       cc_label = excluded.cc_label,
       cc_message_id = NULL,
       updated_at = datetime('now')`,
  ).run(guildId, wiki, page, channelId, label);
}

export function setClubChampionshipMessage(guildId, messageId) {
  db.prepare(`UPDATE guild_settings SET cc_message_id = ?, updated_at = datetime('now') WHERE guild_id = ?`).run(
    messageId,
    guildId,
  );
}

// --- Counter-Strike Valve Regional Standings board ---

export function setCsRankings(guildId, { channelId, region, format }) {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, cs_rankings_channel_id, cs_rankings_region, cs_rankings_format, cs_rankings_message_id, updated_at)
     VALUES (?, ?, ?, ?, NULL, datetime('now'))
     ON CONFLICT (guild_id) DO UPDATE SET
       cs_rankings_channel_id = excluded.cs_rankings_channel_id,
       cs_rankings_region = excluded.cs_rankings_region,
       cs_rankings_format = excluded.cs_rankings_format,
       cs_rankings_message_id = NULL,
       updated_at = datetime('now')`,
  ).run(guildId, channelId, region, format || 'embed');
}

export function setCsRankingsMessage(guildId, messageId) {
  db.prepare(`UPDATE guild_settings SET cs_rankings_message_id = ?, updated_at = datetime('now') WHERE guild_id = ?`).run(
    messageId,
    guildId,
  );
}

export function clearCsRankingsMessage(guildId) {
  db.prepare(`UPDATE guild_settings SET cs_rankings_message_id = NULL, updated_at = datetime('now') WHERE guild_id = ?`).run(
    guildId,
  );
}

// --- Per-game leaderboard boards ---

export function setGameLeaderboard(guildId, game, channelId) {
  db.prepare(
    `INSERT INTO game_leaderboards (guild_id, game, channel_id, message_id, updated_at)
     VALUES (?, ?, ?, NULL, datetime('now'))
     ON CONFLICT (guild_id, game) DO UPDATE SET channel_id = excluded.channel_id, message_id = NULL, updated_at = datetime('now')`,
  ).run(guildId, game, channelId);
}

export function getGameLeaderboards(guildId) {
  return db.prepare('SELECT game, channel_id, message_id FROM game_leaderboards WHERE guild_id = ?').all(guildId);
}

export function setGameLeaderboardMessage(guildId, game, messageId) {
  db.prepare(`UPDATE game_leaderboards SET message_id = ?, updated_at = datetime('now') WHERE guild_id = ? AND game = ?`).run(
    messageId,
    guildId,
    game,
  );
}

// --- Per-game voice channels ---

export function setGameVoiceChannel(guildId, game, channelId) {
  db.prepare(
    `INSERT INTO game_voice_channels (guild_id, game, channel_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (guild_id, game) DO UPDATE SET channel_id = excluded.channel_id, updated_at = datetime('now')`,
  ).run(guildId, game, channelId);
}

export function getGameVoiceChannels(guildId) {
  return db.prepare('SELECT game, channel_id FROM game_voice_channels WHERE guild_id = ?').all(guildId);
}

// --- Per-game match-card boards ---

export function setGameMatchCard(guildId, game, channelId) {
  db.prepare(
    `INSERT INTO game_match_cards (guild_id, game, channel_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (guild_id, game) DO UPDATE SET channel_id = excluded.channel_id, updated_at = datetime('now')`,
  ).run(guildId, game, channelId);
}

export function getGameMatchCards(guildId) {
  return db.prepare('SELECT game, channel_id FROM game_match_cards WHERE guild_id = ?').all(guildId);
}

export function getMatchCardMessages(guildId, game) {
  return db
    .prepare(
      `SELECT match_id, channel_id, message_id
       FROM match_card_messages
       WHERE guild_id = ? AND game = ?`,
    )
    .all(guildId, game);
}

export function setMatchCardMessage(guildId, game, matchId, channelId, messageId) {
  db.prepare(
    `INSERT INTO match_card_messages (guild_id, game, match_id, channel_id, message_id, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (guild_id, game, match_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       message_id = excluded.message_id,
       updated_at = datetime('now')`,
  ).run(guildId, game, matchId, channelId, messageId);
}

export function deleteMatchCardMessage(guildId, game, matchId) {
  db.prepare('DELETE FROM match_card_messages WHERE guild_id = ? AND game = ? AND match_id = ?').run(
    guildId,
    game,
    matchId,
  );
}

export function getGuildsWithClubChampionship() {
  return db
    .prepare(`SELECT guild_id FROM guild_settings WHERE cc_page IS NOT NULL AND cc_channel_id IS NOT NULL`)
    .all()
    .map((r) => r.guild_id);
}

export function getGuildsWithCsRankings() {
  return db
    .prepare(`SELECT guild_id FROM guild_settings WHERE cs_rankings_channel_id IS NOT NULL`)
    .all()
    .map((r) => r.guild_id);
}
