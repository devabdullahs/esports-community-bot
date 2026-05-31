import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { parseTournamentInput } from '../lib/parseTournamentInput.js';
import { setClubChampionship } from '../db/settings.js';
import { updateClubChampionship } from '../jobs/clubChampionship.js';
import { logger } from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('set_ewc')
  .setDescription('Track the EWC Club Championship standings in a channel (admin only).')
  .addStringOption((o) =>
    o
      .setName('url')
      .setDescription('Liquipedia EWC page URL, e.g. https://liquipedia.net/esports/Esports_World_Cup/2026')
      .setRequired(true),
  )
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel for the live standings message')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addStringOption((o) => o.setName('label').setDescription('Title shown on the embed').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const url = interaction.options.getString('url', true);
  const channel = interaction.options.getChannel('channel', true);
  const label = interaction.options.getString('label') || 'EWC 2026 — Club Championship';

  const parsed = parseTournamentInput(url);
  if (!parsed || parsed.source !== 'liquipedia') {
    await interaction.reply({
      content:
        '❌ Please provide a **Liquipedia** EWC page URL, e.g.\n`https://liquipedia.net/esports/Esports_World_Cup/2026`',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // externalId is "<wiki>/<page>" e.g. "esports/Esports_World_Cup/2026"
  const [wiki, ...rest] = parsed.externalId.split('/');
  const page = rest.join('/');
  setClubChampionship(interaction.guildId, { wiki, page, channelId: channel.id, label });

  await interaction.reply({
    content: `✅ **Club Championship tracking set** in ${channel}.\n-# Page \`${wiki}/${page}\` — posting standings now and refreshing automatically.`,
    flags: MessageFlags.Ephemeral,
  });

  try {
    await updateClubChampionship(interaction.client, interaction.guildId);
  } catch (e) {
    logger.warn(`[set_ewc] initial post failed: ${e.message}`);
  }
}
