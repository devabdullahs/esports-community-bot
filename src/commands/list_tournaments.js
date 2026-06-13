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
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const tournaments = (await listActiveTournaments(interaction.guildId)).slice(0, 25);

  const counts = {}; // tournament_id -> { live, upcoming }
  for (const m of await getMatchesForGuild(interaction.guildId)) {
    const c = (counts[m.tournament_id] ??= { live: 0, upcoming: 0 });
    if (m.status === 'running') c.live++;
    else if (m.status === 'scheduled') c.upcoming++;
  }

  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents((td) => td.setContent(`## 📋 Tracked tournaments (${tournaments.length})`));

  if (!tournaments.length) {
    container.addTextDisplayComponents((td) => td.setContent('_None yet._ Add one with `/add_tournament`.'));
  } else {
    container.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
    const lines = tournaments.map((t) => {
      const c = counts[t.id] ?? { live: 0, upcoming: 0 };
      const tag = gameTag(t.game);
      const tagStr = tag ? `\`${tag}\` ` : '';
      const live = c.live ? ` · 🔴 ${c.live} live` : '';
      const up = c.upcoming ? ` · 🗓️ ${c.upcoming} upcoming` : '';
      return `**${t.name || t.external_id}** ${tagStr}\n-# ${t.source} · \`#${t.id}\`${live}${up}`;
    });
    container.addTextDisplayComponents((td) => td.setContent(lines.join('\n')));
  }

  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
