import { getSettings } from '../db/settings.js';
import { logger } from './logger.js';

// Public participation note in the EWC predictions channel so the community can SEE
// who is playing — WITHOUT revealing anyone's picks (the prediction picker itself
// stays ephemeral). Ping-free and best-effort: it must never throw into the
// interaction flow, and it no-ops when no predictions channel is configured.
export async function announceEwcParticipation(client, guildId, content) {
  try {
    if (!client || !guildId || !content) return;
    const channelId = (await getSettings(guildId))?.ewc_predictions_channel_id;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn(`[ewc-predictions] participation announce failed: ${error.message}`);
  }
}
