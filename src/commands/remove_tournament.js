import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { listActiveTournaments, getTournamentById } from '../db/tournaments.js';
import {
  enqueueTournamentOperation,
  tournamentOperationIdempotencyKey,
} from '../db/tournamentOperations.js';
import { sendAuditLog } from '../lib/auditLog.js';

export const data = new SlashCommandBuilder()
  .setName('remove_tournament')
  .setDescription('Archive or temporarily deactivate a tracked tournament.')
  .addIntegerOption((option) =>
    option
      .setName('tournament')
      .setDescription('Start typing to search tracked tournaments')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName('action')
      .setDescription('Archive keeps history; deactivate can be reversed')
      .setRequired(true)
      .addChoices(
        { name: 'Archive and keep historical pages', value: 'archive' },
        { name: 'Deactivate tracking temporarily', value: 'deactivate' },
      ),
  )
  .addBooleanOption((option) =>
    option.setName('confirm').setDescription('Confirm this lifecycle change').setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused().toString().toLowerCase();
  const choices = (await listActiveTournaments(interaction.guildId))
    .filter((tournament) =>
      `${tournament.name ?? ''} ${tournament.external_id}`.toLowerCase().includes(query),
    )
    .slice(0, 25)
    .map((tournament) => ({
      name: `${tournament.name || tournament.external_id} (${tournament.source})`.slice(0, 100),
      value: tournament.id,
    }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const id = interaction.options.getInteger('tournament', true);
  const action = interaction.options.getString('action', true);
  const confirmed = interaction.options.getBoolean('confirm', true);
  const tournament = await getTournamentById(id);

  if (!tournament || tournament.guild_id !== interaction.guildId || !tournament.active) {
    await interaction.reply({
      content: 'That tournament is not actively tracked in this server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!confirmed) {
    await interaction.reply({
      content: 'No change was made. Run the command again with confirmation enabled.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = {
    operation: action,
    tournamentId: id,
    guildId: interaction.guildId,
    requestedActorId: interaction.user.id,
    requestedActorName: interaction.user.displayName || interaction.user.username,
    requestedActorType: 'discord_admin',
  };
  const { operation } = await enqueueTournamentOperation({
    ...request,
    idempotencyKey: tournamentOperationIdempotencyKey(request, interaction.id),
  });

  const verb = action === 'archive' ? 'Archive' : 'Deactivation';
  const container = new ContainerBuilder()
    .setAccentColor(action === 'archive' ? 0xed4245 : 0xfee75c)
    .addTextDisplayComponents((display) =>
      display.setContent(
        `## ${verb} queued\n**${tournament.name || tournament.external_id}**\n` +
          `-# Request \`${operation.id}\``,
      ),
    );
  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

  await sendAuditLog(interaction.client, interaction.guildId, {
    action: `Tournament ${verb} Queued`,
    actor: interaction.user,
    target: tournament.name || tournament.external_id,
    details:
      `Request: ${operation.id}\n` +
      `Source: ${tournament.source}\n` +
      `Game: ${tournament.game || 'auto'}\n` +
      `Identifier: ${tournament.external_id}` +
      `${tournament.url ? `\nURL: ${tournament.url}` : ''}`,
    color: action === 'archive' ? 'danger' : 'warning',
  });
}
