import {
  SlashCommandBuilder,
  InteractionContextType,
  ContainerBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { listActiveTournaments } from '../db/tournaments.js';
import { getMatchesForGuild } from '../db/matches.js';
import { gameTag } from '../lib/render.js';

export const data = new SlashCommandBuilder()
  .setName('list_tournaments')
  .setDescription('Show the tournaments tracked in this server.')
  .addIntegerOption((option) =>
    option.setName('page').setDescription('Page number').setMinValue(1),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const allTournaments = await listActiveTournaments(interaction.guildId);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(allTournaments.length / pageSize));
  const requestedPage = interaction.options.getInteger('page') || 1;
  const page = Math.min(requestedPage, pageCount);
  const tournaments = allTournaments.slice((page - 1) * pageSize, page * pageSize);

  const counts = {};
  for (const match of await getMatchesForGuild(interaction.guildId)) {
    const count = (counts[match.tournament_id] ??= { live: 0, upcoming: 0 });
    if (match.status === 'running') count.live += 1;
    else if (match.status === 'scheduled') count.upcoming += 1;
  }

  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents((display) =>
      display.setContent(`## Tracked tournaments (${allTournaments.length})\n-# Page ${page} of ${pageCount}`),
    );

  if (!tournaments.length) {
    container.addTextDisplayComponents((display) =>
      display.setContent('_None yet._ Add one with `/add_tournament`.'),
    );
  } else {
    container.addSeparatorComponents((separator) =>
      separator.setSpacing(SeparatorSpacingSize.Small),
    );
    const lines = tournaments.map((tournament) => {
      const count = counts[tournament.id] ?? { live: 0, upcoming: 0 };
      const tag = gameTag(tournament.game);
      const tagText = tag ? `\`${tag}\` ` : '';
      const live = count.live ? ` · ${count.live} live` : '';
      const upcoming = count.upcoming ? ` · ${count.upcoming} upcoming` : '';
      return (
        `**${tournament.name || tournament.external_id}** ${tagText}\n` +
        `-# ${tournament.source} · \`#${tournament.id}\`${live}${upcoming}`
      );
    });
    container.addTextDisplayComponents((display) => display.setContent(lines.join('\n')));
  }

  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
