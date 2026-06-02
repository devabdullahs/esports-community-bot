import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { searchGames, gameName } from '../lib/games.js';
import { LIQUIPEDIA_ATTRIBUTION } from '../lib/render.js';
import * as liquipedia from '../services/liquipedia.js';

export const data = new SlashCommandBuilder()
  .setName('player')
  .setDescription('Find a player or team on Liquipedia and get their page link.')
  .addStringOption((o) =>
    o.setName('name').setDescription('Player or team name to look up').setRequired(true).setMaxLength(100),
  )
  .addStringOption((o) =>
    o.setName('game').setDescription('Which game / Liquipedia wiki to search').setRequired(true).setAutocomplete(true),
  )
  .setContexts(InteractionContextType.Guild);

// Game picker is our LOCAL list (no Liquipedia request) — instant and safe.
export async function autocomplete(interaction) {
  const q = interaction.options.getFocused().toString();
  await interaction.respond(searchGames(q));
}

export async function execute(interaction) {
  const name = interaction.options.getString('name', true).trim();
  const game = interaction.options.getString('game', true);
  await interaction.deferReply();

  let results = [];
  try {
    results = await liquipedia.searchPages(game, name, 6);
  } catch {
    /* fall through to the search-link fallback below */
  }

  // No direct match (or rate-limited): hand back a Liquipedia search link instead.
  if (!results.length) {
    const url = liquipedia.searchPageUrl(game, name);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`No exact ${gameName(game)} page for “${name}”`)
      .setDescription(`Couldn't find a direct match. [Search Liquipedia for “${name}”](${url})`)
      .setFooter({ text: LIQUIPEDIA_ATTRIBUTION });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Prefer real player/team pages over sub-pages like "/Results", "/Matches", "/History".
  const mainPages = results.filter((r) => !r.title.includes('/'));
  const list = mainPages.length ? mainPages : results;

  const top = list[0];
  const more = list.slice(1, 5);
  const lines = [`**[${top.title}](${top.url})**`];
  if (top.description) lines.push(top.description);
  if (more.length) {
    lines.push('', '**Other matches**');
    for (const r of more) lines.push(`• [${r.title}](${r.url})`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${gameName(game)} · Liquipedia`)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: LIQUIPEDIA_ATTRIBUTION });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(`Open ${top.title}`.slice(0, 80))
      .setURL(top.url),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}
