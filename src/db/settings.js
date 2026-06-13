import { all, get, run } from './client.js';

const CHANNEL_FIELDS = ['schedule_channel_id', 'voice_channel_id', 'leaderboard_channel_id', 'match_card_channel_id'];

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function getSettings(guildId) {
  return (await get('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId])) ?? {};
}

export async function setChannel(guildId, field, channelId) {
  if (!CHANNEL_FIELDS.includes(field)) throw new Error(`Invalid settings field: ${field}`);
  const now = nowText();
  // field is from a fixed allowlist above, so interpolation here is safe.
  await run(
    `INSERT INTO guild_settings (guild_id, ${field}, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET ${field} = excluded.${field}, updated_at = excluded.updated_at`,
    [guildId, channelId, now],
  );
}

export async function setAuditLogChannel(guildId, channelId) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings (guild_id, audit_log_channel_id, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET
       audit_log_channel_id = excluded.audit_log_channel_id,
       updated_at = excluded.updated_at`,
    [guildId, channelId, now],
  );
}

export async function setEwcPredictionsChannel(guildId, channelId) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings (guild_id, ewc_predictions_channel_id, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET
       ewc_predictions_channel_id = excluded.ewc_predictions_channel_id,
       updated_at = excluded.updated_at`,
    [guildId, channelId, now],
  );
}

// Guild-level fallback news channel. Per-game ewc_games.discord_channel_id takes precedence;
// this is used when a game has no dedicated channel configured.
export async function setEwcNewsChannel(guildId, channelId) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings (guild_id, ewc_news_channel_id, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET
       ewc_news_channel_id = excluded.ewc_news_channel_id,
       updated_at = excluded.updated_at`,
    [guildId, channelId, now],
  );
}

export async function setEwcPredictionsLeaderboard(guildId, { channelId, season = '2026' }) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings
       (guild_id, ewc_predictions_leaderboard_channel_id, ewc_predictions_leaderboard_season, ewc_predictions_leaderboard_message_id, updated_at)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT (guild_id) DO UPDATE SET
       ewc_predictions_leaderboard_channel_id = excluded.ewc_predictions_leaderboard_channel_id,
       ewc_predictions_leaderboard_season = excluded.ewc_predictions_leaderboard_season,
       ewc_predictions_leaderboard_message_id = NULL,
       updated_at = excluded.updated_at`,
    [guildId, channelId, season, now],
  );
}

export async function setEwcPredictionsLeaderboardMessage(guildId, messageId) {
  await run(
    `UPDATE guild_settings
     SET ewc_predictions_leaderboard_message_id = $1, updated_at = $2
     WHERE guild_id = $3`,
    [messageId, nowText(), guildId],
  );
}

export async function setEwcPredictionsMentionsLeaderboard(guildId, { channelId, season = '2026' }) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings
       (guild_id, ewc_predictions_mentions_channel_id, ewc_predictions_mentions_season, ewc_predictions_mentions_message_id, updated_at)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT (guild_id) DO UPDATE SET
       ewc_predictions_mentions_channel_id = excluded.ewc_predictions_mentions_channel_id,
       ewc_predictions_mentions_season = excluded.ewc_predictions_mentions_season,
       ewc_predictions_mentions_message_id = NULL,
       updated_at = excluded.updated_at`,
    [guildId, channelId, season, now],
  );
}

export async function setEwcPredictionsMentionsMessage(guildId, messageId) {
  await run(
    `UPDATE guild_settings
     SET ewc_predictions_mentions_message_id = $1, updated_at = $2
     WHERE guild_id = $3`,
    [messageId, nowText(), guildId],
  );
}

export async function setLeaderboardMessage(guildId, messageId) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings (guild_id, leaderboard_message_id, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET
       leaderboard_message_id = excluded.leaderboard_message_id,
       updated_at = excluded.updated_at`,
    [guildId, messageId, now],
  );
}

export async function clearCombinedLeaderboard(guildId) {
  return run(
    `UPDATE guild_settings
     SET leaderboard_channel_id = NULL, leaderboard_message_id = NULL, updated_at = $1
     WHERE guild_id = $2`,
    [nowText(), guildId],
  );
}

export async function clearCombinedVoiceChannel(guildId) {
  return run('UPDATE guild_settings SET voice_channel_id = NULL, updated_at = $1 WHERE guild_id = $2', [
    nowText(),
    guildId,
  ]);
}

// --- EWC Club Championship tracker (one per guild) ---

export async function setClubChampionship(guildId, { wiki, page, channelId, label }) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings (guild_id, cc_wiki, cc_page, cc_channel_id, cc_label, cc_message_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6)
     ON CONFLICT (guild_id) DO UPDATE SET
       cc_wiki = excluded.cc_wiki,
       cc_page = excluded.cc_page,
       cc_channel_id = excluded.cc_channel_id,
       cc_label = excluded.cc_label,
       cc_message_id = NULL,
       updated_at = excluded.updated_at`,
    [guildId, wiki, page, channelId, label, now],
  );
}

export async function setClubChampionshipMessage(guildId, messageId) {
  await run('UPDATE guild_settings SET cc_message_id = $1, updated_at = $2 WHERE guild_id = $3', [
    messageId,
    nowText(),
    guildId,
  ]);
}

// --- Counter-Strike Valve Regional Standings board ---

export async function setCsRankings(guildId, { channelId, region, format }) {
  const now = nowText();
  await run(
    `INSERT INTO guild_settings (guild_id, cs_rankings_channel_id, cs_rankings_region, cs_rankings_format, cs_rankings_message_id, updated_at)
     VALUES ($1, $2, $3, $4, NULL, $5)
     ON CONFLICT (guild_id) DO UPDATE SET
       cs_rankings_channel_id = excluded.cs_rankings_channel_id,
       cs_rankings_region = excluded.cs_rankings_region,
       cs_rankings_format = excluded.cs_rankings_format,
       cs_rankings_message_id = NULL,
       updated_at = excluded.updated_at`,
    [guildId, channelId, region, format || 'embed', now],
  );
}

export async function setCsRankingsMessage(guildId, messageId) {
  await run('UPDATE guild_settings SET cs_rankings_message_id = $1, updated_at = $2 WHERE guild_id = $3', [
    messageId,
    nowText(),
    guildId,
  ]);
}

export async function clearCsRankingsMessage(guildId) {
  return run('UPDATE guild_settings SET cs_rankings_message_id = NULL, updated_at = $1 WHERE guild_id = $2', [
    nowText(),
    guildId,
  ]);
}

// --- Per-game leaderboard boards ---

export async function setGameLeaderboard(guildId, game, channelId) {
  const now = nowText();
  await run(
    `INSERT INTO game_leaderboards (guild_id, game, channel_id, message_id, updated_at)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT (guild_id, game) DO UPDATE SET
       channel_id = excluded.channel_id,
       message_id = NULL,
       updated_at = excluded.updated_at`,
    [guildId, game, channelId, now],
  );
}

export async function getGameLeaderboards(guildId) {
  return all('SELECT game, channel_id, message_id FROM game_leaderboards WHERE guild_id = $1', [guildId]);
}

export async function setGameLeaderboardMessage(guildId, game, messageId) {
  await run('UPDATE game_leaderboards SET message_id = $1, updated_at = $2 WHERE guild_id = $3 AND game = $4', [
    messageId,
    nowText(),
    guildId,
    game,
  ]);
}

export async function deleteGameLeaderboard(guildId, game) {
  return run('DELETE FROM game_leaderboards WHERE guild_id = $1 AND game = $2', [guildId, game]);
}

// --- Per-game voice channels ---

export async function setGameVoiceChannel(guildId, game, channelId) {
  const now = nowText();
  await run(
    `INSERT INTO game_voice_channels (guild_id, game, channel_id, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, game) DO UPDATE SET
       channel_id = excluded.channel_id,
       updated_at = excluded.updated_at`,
    [guildId, game, channelId, now],
  );
}

export async function getGameVoiceChannels(guildId) {
  return all('SELECT game, channel_id FROM game_voice_channels WHERE guild_id = $1', [guildId]);
}

export async function deleteGameVoiceChannel(guildId, game) {
  return run('DELETE FROM game_voice_channels WHERE guild_id = $1 AND game = $2', [guildId, game]);
}

// --- Per-game match-card boards ---

export async function setGameMatchCard(guildId, game, channelId) {
  const now = nowText();
  await run(
    `INSERT INTO game_match_cards (guild_id, game, channel_id, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, game) DO UPDATE SET
       channel_id = excluded.channel_id,
       updated_at = excluded.updated_at`,
    [guildId, game, channelId, now],
  );
}

export async function getGameMatchCards(guildId) {
  return all('SELECT game, channel_id FROM game_match_cards WHERE guild_id = $1', [guildId]);
}

export async function deleteGameMatchCard(guildId, game) {
  return run('DELETE FROM game_match_cards WHERE guild_id = $1 AND game = $2', [guildId, game]);
}

export async function getMatchCardMessages(guildId, game) {
  return all(
    `SELECT match_id, channel_id, message_id
     FROM match_card_messages
     WHERE guild_id = $1 AND game = $2`,
    [guildId, game],
  );
}

export async function setMatchCardMessage(guildId, game, matchId, channelId, messageId) {
  const now = nowText();
  await run(
    `INSERT INTO match_card_messages (guild_id, game, match_id, channel_id, message_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (guild_id, game, match_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       message_id = excluded.message_id,
       updated_at = excluded.updated_at`,
    [guildId, game, matchId, channelId, messageId, now],
  );
}

export async function deleteMatchCardMessage(guildId, game, matchId) {
  await run('DELETE FROM match_card_messages WHERE guild_id = $1 AND game = $2 AND match_id = $3', [
    guildId,
    game,
    matchId,
  ]);
}

export async function clearMatchCardMessages(guildId, game) {
  return run('DELETE FROM match_card_messages WHERE guild_id = $1 AND game = $2', [guildId, game]);
}

export async function getGuildsWithClubChampionship() {
  const rows = await all('SELECT guild_id FROM guild_settings WHERE cc_page IS NOT NULL AND cc_channel_id IS NOT NULL');
  return rows.map((r) => r.guild_id);
}

export async function getGuildsWithCsRankings() {
  const rows = await all('SELECT guild_id FROM guild_settings WHERE cs_rankings_channel_id IS NOT NULL');
  return rows.map((r) => r.guild_id);
}

export async function getGuildsWithEwcPredictionLeaderboard() {
  const rows = await all(
    `SELECT guild_id
     FROM guild_settings
     WHERE ewc_predictions_leaderboard_channel_id IS NOT NULL
        OR ewc_predictions_mentions_channel_id IS NOT NULL`,
  );
  return rows.map((r) => r.guild_id);
}
