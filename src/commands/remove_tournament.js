import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { listActiveTournaments, getTournamentById, deactivateTournament } from '../db/tournaments.js';
import { refreshGuild } from '../jobs/refresh.js';
import { sendAuditLog } from '../lib/auditLog.js';

export const data = new SlashCommandBuilder()
  .setName('remove_tournament')
  .setDescription('Stop tracking a tournament (admin only).')
  .addIntegerOption((o) =>
    o.setName('tournament').setDescription('Start typing to search tracked tournaments').setRequired(true).setAutocomplete(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused().toString().toLowerCase();
  const choices = (await listActiveTournaments(interaction.guildId))
    .filter((t) => `${t.name ?? ''} ${t.external_id}`.toLowerCase().includes(query))
    .slice(0, 25)
    .map((t) => ({ name: `${t.name || t.external_id} (${t.source})`.slice(0, 100), value: t.id }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const id = interaction.options.getInteger('tournament', true);
  const t = await getTournamentById(id);

  if (!t || t.guild_id !== interaction.guildId || !t.active) {
    await interaction.reply({ content: '❌ That tournament isn’t tracked in this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  await deactivateTournament(id, interaction.guildId);

  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents((td) => td.setContent(`🗑️ Stopped tracking **${t.name || t.external_id}**.`));
  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Tournament Removed',
    actor: interaction.user,
    target: t.name || t.external_id,
    details:
      `Source: ${t.source}\n` +
      `Game: ${t.game || 'auto'}\n` +
      `Identifier: ${t.external_id}` +
      `${t.url ? `\nURL: ${t.url}` : ''}`,
    color: 'danger',
  });

  refreshGuild(interaction.client, interaction.guildId);
}
