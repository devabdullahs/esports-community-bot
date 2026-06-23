import { getSettings } from '../db/settings.js';
import { logger } from './logger.js';

// Public participation note so the community can see who is playing without
// revealing anyone's picks. Prefer the command channel; fall back to the
// configured predictions channel for non-interaction callers.
export async function announceEwcParticipation(client, guildId, content, options = {}) {
  try {
    if (!client || !guildId || !content) return;
    const channelId = options.channelId || (await getSettings(guildId))?.ewc_predictions_channel_id;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn(`[ewc-predictions] participation announce failed: ${error.message}`);
  }
}
