import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { fetchValveRegionalStandings } from '../services/liquipedia.js';
import { getGuildsWithCsRankings, getSettings, setCsRankingsMessage } from '../db/settings.js';
import { renderCsRankingsCard } from '../lib/csRankingsCard.js';

const FOOTER = 'Data from Liquipedia — CC-BY-SA 3.0';

function rankLine(row) {
  const rank = row.globalRank && row.globalRank !== row.rank ? `#${row.rank} (Global #${row.globalRank})` : `#${row.rank}`;
  const roster = row.roster?.length ? `\n-# ${row.roster.slice(0, 5).join(', ')}` : '';
  const region = row.region ? ` · ${row.region}` : '';
  return `**${rank} ${row.team}** — \`${row.points.toFixed(1)} pts\`${region}${roster}`;
}

export function buildCsRankingsEmbed(data) {
  const rows = data.standings.slice(0, 15);
  const description = rows.length
    ? rows.map(rankLine).join('\n')
    : 'No Valve Regional Standings rows found.';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`Counter-Strike Valve Rankings — ${data.label}`)
    .setURL(data.sourceUrl)
    .setDescription(description)
    .setTimestamp(new Date())
    .setFooter({ text: FOOTER });

  if (data.date) embed.addFields({ name: 'Snapshot', value: data.date, inline: true });
  embed.addFields({ name: 'Region', value: data.label, inline: true });
  return embed;
}

export async function buildCsRankingsImagePayload(data) {
  const imageName = `cs-rankings-${data.region}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(renderCsRankingsCard(data), { name: imageName });
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`Counter-Strike Valve Rankings — ${data.label}`)
    .setURL(data.sourceUrl)
    .setImage(`attachment://${imageName}`)
    .setTimestamp(new Date())
    .setFooter({ text: FOOTER });
  if (data.date) embed.setDescription(`Snapshot: **${data.date}**`);
  return { embeds: [embed], files: [attachment] };
}

export async function updateCsRankings(client, guildId) {
  const s = getSettings(guildId);
  if (!s.cs_rankings_channel_id) return false;

  const channel = await client.channels.fetch(s.cs_rankings_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  let data;
  try {
    data = await fetchValveRegionalStandings(s.cs_rankings_region || 'global');
  } catch (e) {
    const level = /backing off after a rate limit/i.test(e.message) ? 'debug' : 'error';
    logger[level](`[cs-rankings] fetch failed for ${guildId}: ${e.message}`);
    return false;
  }

  const payload =
    s.cs_rankings_format === 'image'
      ? await buildCsRankingsImagePayload(data)
      : { embeds: [buildCsRankingsEmbed(data)], files: [] };
  if (s.cs_rankings_message_id) {
    const msg = await channel.messages.fetch(s.cs_rankings_message_id).catch(() => null);
    if (msg) {
      await msg.edit({ ...payload, attachments: [] });
      return true;
    }
  }

  const sent = await channel.send(payload);
  setCsRankingsMessage(guildId, sent.id);
  logger.info(`[cs-rankings] posted standings message ${sent.id} in guild ${guildId}`);
  return true;
}

let timer = null;
let running = false;

export function startCsRankings(client) {
  const minutes = Math.max(30, config.csRankings.refreshMinutes);
  const run = async () => {
    if (running) {
      logger.debug('[cs-rankings] previous refresh still running; skipping this tick');
      return;
    }
    running = true;
    try {
      for (const guildId of getGuildsWithCsRankings()) {
        await updateCsRankings(client, guildId).catch((e) => logger.error(`[cs-rankings] ${guildId}: ${e.message}`));
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => run().catch((e) => logger.error(`[cs-rankings] ${e.message}`)), minutes * 60 * 1000);
  timer.unref?.();
  logger.info(`[cs-rankings] refresh every ${minutes}m.`);
  run().catch((e) => logger.error(`[cs-rankings] ${e.message}`));
}

export function stopCsRankings() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
