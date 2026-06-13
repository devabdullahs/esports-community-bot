import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ContainerBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { parseTournamentInput } from '../lib/parseTournamentInput.js';
import { addTournament, listActiveTournaments } from '../db/tournaments.js';
import { syncTournament } from '../jobs/morningSync.js';
import { refreshGuild } from '../jobs/refresh.js';
import { searchGames } from '../lib/games.js';
import { logger } from '../lib/logger.js';
import { sendAuditLog } from '../lib/auditLog.js';

export const data = new SlashCommandBuilder()
  .setName('add_tournament')
  .setDescription('Track a tournament for schedules, live scores, and brackets.')
  .addStringOption((o) =>
    o
      .setName('identifier')
      .setDescription('Liquipedia URL (recommended, free), Start.gg URL/slug, or PandaScore ID')
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('game')
      .setDescription('Game (optional — auto-detected from Liquipedia URLs; start typing to search)')
      .setAutocomplete(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function autocomplete(interaction) {
  await interaction.respond(searchGames(interaction.options.getFocused()));
}

export async function execute(interaction) {
  const identifier = interaction.options.getString('identifier', true);
  const gameOverride = interaction.options.getString('game');

  const parsed = parseTournamentInput(identifier);
  if (!parsed) {
    await interaction.reply({
      content:
        `❌ I couldn't recognize \`${identifier}\`.\n` +
        'Provide a **Liquipedia** URL (recommended), a **Start.gg** URL/slug, or a **PandaScore** ID.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const record = await addTournament({
    source: parsed.source,
    external_id: parsed.externalId,
    game: gameOverride || parsed.game,
    name: parsed.name,
    url: parsed.url,
    guild_id: interaction.guildId,
    added_by: interaction.user.id,
  });

  const count = (await listActiveTournaments(interaction.guildId)).length;
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ✅ Now tracking\n**${record.name || record.external_id}**`),
    )
    .addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((td) =>
      td.setContent(
        `-# Source \`${record.source}\` · Game \`${record.game || 'auto'}\` · ${count} tournament(s) tracked here\n` +
          `-# Matches will appear shortly — Liquipedia is polled gently (≈30s between fetches).`,
      ),
    );
  if (record.url) {
    container.addTextDisplayComponents((td) => td.setContent(`🔗 ${record.url}`));
  }

  // Reply instantly, then fetch this tournament's matches in the BACKGROUND via the rate limiter
  // and refresh the boards. Firing a parse request synchronously on every /add is what tripped
  // Liquipedia's 1-request-per-30s limit when several tournaments were added in quick succession.
  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Tournament Added',
    actor: interaction.user,
    target: record.name || record.external_id,
    details:
      `Source: ${record.source}\n` +
      `Game: ${record.game || 'auto'}\n` +
      `Identifier: ${record.external_id}` +
      `${record.url ? `\nURL: ${record.url}` : ''}`,
    color: 'success',
  });
  syncTournament(interaction.client, record)
    .then(() => refreshGuild(interaction.client, interaction.guildId))
    .catch((e) => logger.warn(`[add] background sync failed for ${record.source}:${record.external_id}: ${e.message}`));
}
