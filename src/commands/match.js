import {
  SlashCommandBuilder,
  InteractionContextType,
  ContainerBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { getMatchesForGuild } from '../db/matches.js';
import { gameTag, tournamentUrl } from '../lib/render.js';

export const data = new SlashCommandBuilder()
  .setName('match')
  .setDescription('Show details for a tracked match.')
  .addIntegerOption((o) =>
    o.setName('match').setDescription('Search live / upcoming / recent matches').setRequired(true).setAutocomplete(true),
  )
  .setContexts(InteractionContextType.Guild);

const STATUS = {
  running: { label: '🔴 Live now', icon: '🔴', color: 0xed4245, order: 0 },
  scheduled: { label: '🗓️ Upcoming', icon: '🗓️', color: 0x5865f2, order: 1 },
  finished: { label: '✅ Finished', icon: '✅', color: 0x57f287, order: 2 },
};

export async function autocomplete(interaction) {
  const q = interaction.options.getFocused().toString().toLowerCase();
  const choices = getMatchesForGuild(interaction.guildId)
    .filter((m) => `${m.team_a} ${m.team_b}`.toLowerCase().includes(q))
    .sort((a, b) => (STATUS[a.status]?.order ?? 9) - (STATUS[b.status]?.order ?? 9))
    .slice(0, 25)
    .map((m) => {
      const sc = m.score_a != null && m.score_b != null ? ` ${m.score_a}-${m.score_b}` : '';
      return { name: `${STATUS[m.status]?.icon ?? ''} ${m.team_a} vs ${m.team_b}${sc}`.slice(0, 100), value: m.id };
    });
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const id = interaction.options.getInteger('match', true);
  const m = getMatchesForGuild(interaction.guildId).find((x) => x.id === id);
  if (!m) {
    await interaction.reply({ content: '❌ That match isn’t tracked here anymore.', flags: MessageFlags.Ephemeral });
    return;
  }

  const meta = STATUS[m.status] ?? STATUS.scheduled;
  const tag = gameTag(m.game);
  const url = tournamentUrl(m);
  const hasScore = m.score_a != null && m.score_b != null;
  const teamA = hasScore && m.score_a > m.score_b ? `**${m.team_a}**` : m.team_a;
  const teamB = hasScore && m.score_b > m.score_a ? `**${m.team_b}**` : m.team_b;
  const middle = hasScore ? `\`${m.score_a} – ${m.score_b}\`` : '`vs`';

  const c = new ContainerBuilder().setAccentColor(meta.color);
  c.addTextDisplayComponents((td) => td.setContent(`## ${meta.label}${tag ? `  ·  \`${tag}\`` : ''}`));
  c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  c.addTextDisplayComponents((td) => td.setContent(`### ${teamA}  ${middle}  ${teamB}`));

  const lines = [];
  if (m.scheduled_at) {
    if (m.status === 'scheduled') lines.push(`🗓️ <t:${m.scheduled_at}:F> · <t:${m.scheduled_at}:R>`);
    else if (m.status === 'running') lines.push(`🔴 Started <t:${m.scheduled_at}:R>`);
    else lines.push(`🏁 <t:${m.scheduled_at}:f>`);
  }
  if (m.tournament_name) lines.push(`🏆 ${m.tournament_name}`);
  if (url) lines.push(`🔗 [Full match details](${url})`);
  if (lines.length) {
    c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents((td) => td.setContent(lines.map((l) => `-# ${l}`).join('\n')));
  }

  await interaction.reply({ components: [c], flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] });
}
