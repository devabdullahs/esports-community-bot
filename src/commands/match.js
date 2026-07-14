import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { getMatchesForGuild } from '../db/matches.js';
import { buildMatchFollowRow } from '../lib/followComponents.js';
import { buildMatchCardPayload, MATCH_STATUS } from '../lib/matchMessage.js';
import { tryAcquireRenderSlot } from '../lib/renderGate.js';

export const data = new SlashCommandBuilder()
  .setName('match')
  .setDescription('Show details for a tracked match.')
  .addIntegerOption((o) =>
    o.setName('match').setDescription('Search live / upcoming / recent matches').setRequired(true).setAutocomplete(true),
  )
  .setContexts(InteractionContextType.Guild);

const STATUS = {
  running: { ...MATCH_STATUS.running, icon: 'LIVE' },
  scheduled: { ...MATCH_STATUS.scheduled, icon: 'NEXT' },
  finished: { ...MATCH_STATUS.finished, icon: 'DONE' },
};

export async function autocomplete(interaction) {
  const q = interaction.options.getFocused().toString().toLowerCase();
  const choices = (await getMatchesForGuild(interaction.guildId))
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
  const m = (await getMatchesForGuild(interaction.guildId)).find((x) => x.id === id);
  if (!m) {
    await interaction.reply({ content: "That match isn't tracked here anymore.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Canvas admission: one card at a time per member, bounded globally, so a
  // mashed command can't stack CPU-bound renders in the shared container.
  const slot = tryAcquireRenderSlot(interaction.user.id);
  if (!slot.ok) {
    await interaction.reply({
      content: 'A card is already being rendered — try again in a few seconds.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = await buildMatchCardPayload(m);
    const followRow = buildMatchFollowRow(m, { locale: interaction.locale });
    if (followRow && (payload.components?.length || 0) < 5) {
      payload.components = [...(payload.components || []), followRow];
    }
    await interaction.editReply(payload);
  } finally {
    slot.release();
  }
}
