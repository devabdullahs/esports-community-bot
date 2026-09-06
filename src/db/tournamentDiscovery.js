import { all, get } from './client.js';
import { GAMES, normalizeGameSlug } from '../lib/games.js';

export async function listDiscoveryGames(guildId) {
  const rows = await all(`SELECT game FROM game_match_cards WHERE guild_id = $1
    UNION SELECT game FROM game_leaderboards WHERE guild_id = $1
    UNION SELECT game FROM game_voice_channels WHERE guild_id = $1
    UNION SELECT game FROM tournaments WHERE guild_id = $1 AND active = 1 AND archived_at IS NULL`, [guildId]);
  const known = new Set(GAMES.map(game => game.slug));
  return [...new Set(rows.map(row => normalizeGameSlug(row.game)))].filter(game => known.has(game) && game !== 'esports').sort();
}

export async function hasDiscoveredTournament(guildId, identity) {
  // Include archived/deactivated rows: discovery must respect an admin's removal.
  return Boolean(await get(`SELECT id FROM tournaments WHERE guild_id = $1 AND
    ((source = 'liquipedia' AND external_id = $2) OR url = $3) LIMIT 1`, [guildId, identity.sourceId, identity.url]));
}
