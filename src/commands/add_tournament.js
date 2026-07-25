import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ContainerBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { parseTournamentInput } from '../lib/parseTournamentInput.js';
import {
  enqueueTournamentOperation,
  tournamentOperationIdempotencyKey,
} from '../db/tournamentOperations.js';
import { searchGames } from '../lib/games.js';
import { sendAuditLog } from '../lib/auditLog.js';

export const data = new SlashCommandBuilder()
  .setName('add_tournament')
  .setDescription('Validate and track a tournament for schedules, live scores, and brackets.')
  .addStringOption((option) =>
    option
      .setName('identifier')
      .setDescription('Liquipedia URL, Start.gg event URL/slug, or PandaScore ID')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('game')
      .setDescription('Game override (optional; start typing to search)')
      .setAutocomplete(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function autocomplete(interaction) {
  await interaction.respond(searchGames(interaction.options.getFocused()));
}

export async function execute(interaction) {
  const identifier = interaction.options.getString('identifier', true);
  const parsed = parseTournamentInput(identifier);
  if (!parsed) {
    await interaction.reply({
      content:
        `I could not recognize \`${identifier}\`.\n` +
        'Provide a complete Liquipedia URL, Start.gg event URL/slug, or PandaScore ID.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = {
    operation: 'validate_and_activate',
    source: parsed.source,
    sourceId: parsed.externalId,
    game: interaction.options.getString('game') || parsed.game,
    guildId: interaction.guildId,
    requestedActorId: interaction.user.id,
    requestedActorName: interaction.user.displayName || interaction.user.username,
    requestedActorType: 'discord_admin',
  };

  let queued;
  try {
    queued = await enqueueTournamentOperation({
      ...request,
      idempotencyKey: tournamentOperationIdempotencyKey(request, interaction.id),
    });
  } catch {
    await interaction.reply({
      content: 'That tournament source or game is not valid.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const operation = queued.operation;
  const label = parsed.name || parsed.externalId;
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents((display) =>
      display.setContent(`## Tournament validation queued\n**${label}**`),
    )
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((display) =>
      display.setContent(
        `-# Request \`${operation.id}\` · Source \`${parsed.source}\` · Game \`${request.game || 'auto'}\`\n` +
          '-# Tracking begins only after provider validation succeeds.',
      ),
    );
  if (parsed.url) container.addTextDisplayComponents((display) => display.setContent(parsed.url));

  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Tournament Validation Queued',
    actor: interaction.user,
    target: label,
    details:
      `Request: ${operation.id}\n` +
      `Source: ${parsed.source}\n` +
      `Game: ${request.game || 'auto'}\n` +
      `Identifier: ${parsed.externalId}` +
      `${parsed.url ? `\nURL: ${parsed.url}` : ''}`,
    color: 'info',
  });
}
