import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { searchGames, gameName, getGame } from '../lib/games.js';
import { LIQUIPEDIA_ATTRIBUTION } from '../lib/render.js';
import * as liquipedia from '../services/liquipedia.js';

export const data = new SlashCommandBuilder()
  .setName('lookup')
  .setDescription('Look up a player or team on Liquipedia and get their page link.')
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

// Heuristic filter (no extra API calls): players & teams almost never carry tournament/event
// vocabulary or a year, so we drop titles that do — plus sub-pages and the game's own page.
// Keeps the lookup focused on players + teams without a second request per call.
const EVENT_WORDS =
  /\b(series|leagues?|cups?|championships?|champions|majors?|minors?|qualifiers?|seasons?|playoffs?|invitational|masters|circuit|splits?|groups?|brackets?|finals?|regionals?|showdown|tour|gauntlet|ladder|clash|challengers?|contenders?|premier|conference|divisions?|stages?|weeks?|worlds?|tournaments?|events?|open)\b/i;

export function isPlayerOrTeam(title, game) {
  const t = String(title || '').trim();
  if (!t || t.includes('/')) return false; // sub-pages like /Results, /Matches, /History
  if (/\b(19|20)\d{2}\b/.test(t)) return false; // a year → season / tournament page
  if (EVENT_WORDS.test(t)) return false; // tournament / event vocabulary
  if (/^(list of|portal:|category:|template:)/i.test(t) || /disambiguation/i.test(t)) return false;
  const lower = t.toLowerCase();
  if (lower === game.toLowerCase() || lower === gameName(game).toLowerCase()) return false; // the game's own page
  return true;
}

export async function execute(interaction) {
  const name = interaction.options.getString('name', true).trim();
  // `game` is autocomplete-only, so Discord does NOT guarantee a known slug. Validate it locally
  // (resolving aliases) before touching Liquipedia. The check is sync, so reject before deferring.
  const game = getGame(interaction.options.getString('game', true));
  if (!game) {
    await interaction.reply({
      content: '❌ Unknown game — pick one from the **game** autocomplete list.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const slug = game.slug;
  await interaction.deferReply();

  let results = [];
  try {
    // Fetch a few extra so enough survive the player/team filter below.
    results = await liquipedia.searchPages(slug, name, 10);
  } catch {
    /* fall through to the search-link fallback below */
  }

  // Keep only player/team pages — drop tournaments, events, sub-pages, and the game's own page.
  const list = results.filter((r) => isPlayerOrTeam(r.title, slug));

  // Nothing player/team-like (or rate-limited): hand back a Liquipedia search link instead.
  if (!list.length) {
    const url = liquipedia.searchPageUrl(slug, name);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`No ${gameName(slug)} player or team for “${name}”`)
      .setDescription(`Couldn't find a matching player or team. [Search Liquipedia for “${name}”](${url})`)
      .setFooter({ text: LIQUIPEDIA_ATTRIBUTION });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

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
    .setTitle(`${gameName(slug)} · Liquipedia`)
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
