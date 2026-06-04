import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  countOverallScored,
  countSeasonScored,
  countWeeklyScored,
  getEwcSeason,
  getEwcWeek,
  listEwcWeeks,
  overallLeaderboard,
  seasonLeaderboard,
  upsertSeasonPrediction,
  upsertWeeklyPrediction,
  userPredictionProfile,
  weeklyLeaderboard,
} from '../db/ewcPredictions.js';
import { formatTimestamp, uniqueClubPicks } from '../lib/ewcPredictions.js';
import { searchEwcClubChoices } from '../lib/ewcClubCache.js';

const DEFAULT_SEASON = '2026';
const PAGE_SIZE = 20;

function addTeamOption(command, index, required) {
  return command.addStringOption((o) =>
    o
      .setName(`team_${index}`)
      .setDescription(`Club pick #${index}`)
      .setAutocomplete(true)
      .setRequired(required),
  );
}

let builder = new SlashCommandBuilder()
  .setName('ewc_predict')
  .setDescription('Submit EWC predictions and view prediction leaderboards.')
  .addSubcommand((s) =>
    addTeamOption(addTeamOption(addTeamOption(s.setName('weekly').setDescription('Pick 3 clubs for a weekly round.'), 1, true), 2, true), 3, true)
      .addStringOption((o) => o.setName('week').setDescription('Week key').setAutocomplete(true).setRequired(true))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  );

function seasonCommand(s) {
  let cmd = s.setName('season').setDescription('Pick your top 5-10 clubs for the whole EWC season.');
  for (let i = 1; i <= 10; i += 1) cmd = addTeamOption(cmd, i, i <= 5);
  return cmd.addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false));
}

builder = builder
  .addSubcommand(seasonCommand)
  .addSubcommand((s) =>
    s
      .setName('leaderboard')
      .setDescription('Show an EWC prediction leaderboard.')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Leaderboard type')
          .setRequired(true)
          .addChoices(
            { name: 'Overall', value: 'overall' },
            { name: 'Weekly', value: 'weekly' },
            { name: 'Season', value: 'season' },
          ),
      )
      .addStringOption((o) => o.setName('week').setDescription('Week key for weekly leaderboard').setAutocomplete(true))
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('profile')
      .setDescription('Show your EWC prediction profile.')
      .addUserOption((o) => o.setName('member').setDescription('Member to inspect'))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) => s.setName('guide').setDescription('Show an Arabic guide for the EWC prediction system.'))
  .addSubcommand((s) =>
    s
      .setName('teams')
      .setDescription('Search the EWC club list.')
      .addStringOption((o) => o.setName('query').setDescription('Club name').setAutocomplete(true)),
  )
  .setContexts(InteractionContextType.Guild);

export const data = builder;

function season(interaction) {
  return interaction.options.getString('season') || DEFAULT_SEASON;
}

function teamPicks(interaction, max = 10) {
  const picks = [];
  for (let i = 1; i <= max; i += 1) picks.push(interaction.options.getString(`team_${i}`));
  return picks;
}

function roundClosedMessage(round) {
  if (!round) return 'That prediction round does not exist.';
  if (round.status !== 'open') return `That round is already \`${round.status}\`.`;
  const now = Math.floor(Date.now() / 1000);
  if (round.open_at && now < round.open_at) return `That round opens ${formatTimestamp(round.open_at)}.`;
  if (round.close_at && now >= round.close_at) return `That round closed ${formatTimestamp(round.close_at)}.`;
  return null;
}

function formatPicks(picks) {
  return picks.map((pick, index) => `**${index + 1}.** ${pick}`).join('\n');
}

function leaderboardLines(rows, offset = 0) {
  if (!rows.length) return 'No scored predictions yet.';
  return rows
    .map((row, index) => `**${offset + index + 1}.** <@${row.user_id}> — \`${Number(row.score || 0).toLocaleString()}\``)
    .join('\n');
}

// custom_id: "ewc_predict:<action>:<type>:<season>:<week|->:<page>" — parsed by the interaction
// router (first segment = command name) and by handleComponent/handleModal below.
const lbId = (action, type, season, week, page, ownerId) =>
  `ewc_predict:${action}:${type}:${season}:${week || '-'}:${page}:${ownerId}`;

// Resolve title + total count + a page fetcher for a leaderboard type. null if the round is gone.
function leaderboardData(guildId, type, season, week) {
  if (type === 'weekly') {
    const round = getEwcWeek(guildId, season, week);
    if (!round) return null;
    return {
      title: `EWC Weekly Predictions — ${round.label || round.week_key}`,
      count: countWeeklyScored(round.id),
      fetch: (limit, offset) => weeklyLeaderboard(round.id, limit, offset),
    };
  }
  if (type === 'season') {
    return {
      title: `EWC ${season} Season Predictions`,
      count: countSeasonScored(guildId, season),
      fetch: (limit, offset) => seasonLeaderboard(guildId, season, limit, offset),
    };
  }
  const best = getEwcSeason(guildId, season)?.best_weeks;
  return {
    title: `EWC ${season} Prediction Leaderboard${best ? ` · best ${best} weeks` : ''}`,
    count: countOverallScored(guildId, season),
    fetch: (limit, offset) => overallLeaderboard(guildId, season, limit, offset),
  };
}

// Build a leaderboard page: embed + (Prev / Page X/Y / Next) buttons. Buttons only appear when
// there is more than one page. The middle button opens a "go to page" modal.
function buildLeaderboardPage(guildId, type, season, week, page = 1, ownerId = '') {
  const data = leaderboardData(guildId, type, season, week);
  if (!data) return null;
  const totalPages = Math.max(1, Math.ceil(data.count / PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), totalPages);
  const offset = (p - 1) * PAGE_SIZE;
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(data.title)
    .setDescription(leaderboardLines(data.fetch(PAGE_SIZE, offset), offset))
    .setFooter({ text: `Page ${p} / ${totalPages} · ${data.count} ranked` });

  const components = [];
  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(lbId('lb', type, season, week, p - 1, ownerId))
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p <= 1),
        new ButtonBuilder()
          .setCustomId(lbId('lbgoto', type, season, week, p, ownerId))
          .setLabel(`Page ${p}/${totalPages}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(lbId('lb', type, season, week, p + 1, ownerId))
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p >= totalPages),
      ),
    );
  }
  return { embeds: [embed], components, totalPages, page: p };
}

async function autocompleteWeek(interaction) {
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const seasonYear = season(interaction);
  const weeks = listEwcWeeks(interaction.guildId, seasonYear);
  await interaction.respond(
    weeks
      .filter((week) => !q || week.week_key.toLowerCase().includes(q) || String(week.label || '').toLowerCase().includes(q))
      .slice(0, 25)
      .map((week) => ({ name: `${week.label || week.week_key} (${week.status})`, value: week.week_key })),
  );
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'week') {
    await autocompleteWeek(interaction);
    return;
  }
  await interaction.respond(await searchEwcClubChoices(focused.value));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const seasonYear = season(interaction);

  if (sub === 'weekly') {
    const weekKey = interaction.options.getString('week', true);
    const round = getEwcWeek(interaction.guildId, seasonYear, weekKey);
    const closed = roundClosedMessage(round);
    if (closed) {
      await interaction.reply({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const picks = uniqueClubPicks(teamPicks(interaction, 3), 3);
    upsertWeeklyPrediction({ guildId: interaction.guildId, weekId: round.id, userId: interaction.user.id, picks });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`✅ Weekly picks locked — ${round.label || round.week_key}`)
          .setDescription(formatPicks(picks)),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'season') {
    const round = getEwcSeason(interaction.guildId, seasonYear);
    const closed = roundClosedMessage(round);
    if (closed) {
      await interaction.reply({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const picks = uniqueClubPicks(teamPicks(interaction, 10));
    if (picks.length !== round.top_size) {
      await interaction.reply({
        content: `❌ This season round needs exactly **${round.top_size}** different club picks.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    upsertSeasonPrediction({ guildId: interaction.guildId, season: seasonYear, userId: interaction.user.id, picks });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`✅ Season picks locked — ${round.label || `EWC ${seasonYear}`}`)
          .setDescription(formatPicks(picks)),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'leaderboard') {
    const type = interaction.options.getString('type', true);
    const page = interaction.options.getInteger('page') || 1;
    let week = null;
    if (type === 'weekly') {
      week = interaction.options.getString('week');
      if (!week) {
        await interaction.reply({ content: '❌ Choose a `week` for the weekly leaderboard.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (!getEwcWeek(interaction.guildId, seasonYear, week)) {
        await interaction.reply({ content: `❌ Week \`${week}\` does not exist.`, flags: MessageFlags.Ephemeral });
        return;
      }
    }
    const payload = buildLeaderboardPage(interaction.guildId, type, seasonYear, week, page, interaction.user.id);
    await interaction.reply({ embeds: payload.embeds, components: payload.components });
    return;
  }

  if (sub === 'profile') {
    const user = interaction.options.getUser('member') || interaction.user;
    const profile = userPredictionProfile(interaction.guildId, seasonYear, user.id);
    const weekly = profile.weekly
      .filter((row) => row.picks?.length || row.score != null)
      .slice(-5)
      .map((row) => `• **${row.label || row.week_key}** — ${row.picks?.join(', ') || 'No picks'}${row.score != null ? ` — \`${row.score}\`` : ''}`);
    const seasonPicks = profile.season?.picks?.length ? profile.season.picks.join(', ') : 'No season picks yet.';
    const seasonValue = `${seasonPicks}${profile.season?.score != null ? ` — \`${profile.season.score}\`` : ''}`;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setAuthor({ name: `${user.globalName || user.username} — EWC Prediction Profile`, iconURL: user.displayAvatarURL() })
          .addFields(
            { name: 'Season picks', value: seasonValue.slice(0, 1024) },
            { name: 'Recent weekly picks', value: (weekly.length ? weekly.join('\n') : 'No weekly picks yet.').slice(0, 1024) },
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'guide') {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('نظام توقّعات كأس العالم للرياضات الإلكترونية')
          .setDescription(
            'الفكرة بسيطة: كل أسبوع تختار **ثلاثة أندية** تتوقّع أن تحقّق أعلى النقاط في ترتيب الأندية خلال ذلك الأسبوع.\n\n' +
              '**التوقّع الأسبوعي**\n' +
              'اختر الأسبوع وثلاثة أندية باستخدام:\n' +
              '`/ewc_predict weekly`\n' +
              'بعد إغلاق باب التوقّعات، يحسب البوت الفرق بين ترتيب الأندية في بداية الأسبوع ونهايته، وتُحتسب نقاطك بحسب النقاط الفعلية التي حققتها الأندية التي اخترتها. وإذا جاءت اختياراتك الثلاثة جميعها ضمن أفضل ثلاثة أندية في ذلك الأسبوع، فستحصل على مكافأة إضافية.\n\n' +
              '**توقّع الموسم الكامل**\n' +
              'اختر أفضل خمسة إلى عشرة أندية (حسب إعدادات الإدارة) باستخدام:\n' +
              '`/ewc_predict season`\n' +
              'تُحتسب هذه التوقّعات في نهاية البطولة بحسب الترتيب النهائي للأندية.\n\n' +
              '**أوامر مفيدة**\n' +
              'لعرض ترتيب المشاركين:\n' +
              '`/ewc_predict leaderboard`\n' +
              'لعرض توقّعاتك ونتائجك:\n' +
              '`/ewc_predict profile`\n' +
              'للبحث عن الأندية المشاركة:\n' +
              '`/ewc_predict teams`\n\n' +
              'تعتمد النتائج على بيانات موقع Liquipedia، لذلك تُغلق التوقّعات في وقت محدّد ثم ينتظر البوت فترة أمان قبل الاحتساب حتى يستقرّ الترتيب.',
          ),
      ],
    });
    return;
  }

  if (sub === 'teams') {
    const query = interaction.options.getString('query') || '';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const choices = await searchEwcClubChoices(query, { wait: true });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`EWC Clubs${query ? ` — “${query}”` : ''}`)
          .setDescription(
            (choices.length ? choices.map((c) => `• ${c.name}`).join('\n') : 'No EWC clubs matched that search.').slice(0, 4000),
          ),
      ],
    });
  }
}

// --- Leaderboard pagination (routed here via the "ewc_predict:" custom_id prefix) ---
export async function handleComponent(interaction) {
  const [, action, type, season, weekRaw, pageRaw, ownerId] = interaction.customId.split(':');
  const week = weekRaw === '-' ? null : weekRaw;

  // Only the member who ran /ewc_predict leaderboard can drive its buttons.
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'These buttons belong to whoever ran the command — use `/ewc_predict leaderboard` to get your own.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'lbgoto') {
    const data = leaderboardData(interaction.guildId, type, season, week);
    const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
    const modal = new ModalBuilder()
      .setCustomId(`ewc_predict:lbmodal:${type}:${season}:${week || '-'}:${ownerId}`)
      .setTitle(`Go to page (1-${totalPages})`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('page')
            .setLabel(`Page number (1-${totalPages})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(6)
            .setPlaceholder(String(pageRaw || 1)),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // action === 'lb' → jump to the page baked into the button's custom_id.
  const payload = buildLeaderboardPage(interaction.guildId, type, season, week, Number(pageRaw) || 1, ownerId);
  if (!payload) {
    await interaction.deferUpdate().catch(() => {});
    return;
  }
  await interaction.update({ embeds: payload.embeds, components: payload.components });
}

export async function handleModal(interaction) {
  const [, , type, season, weekRaw, ownerId] = interaction.customId.split(':');
  const week = weekRaw === '-' ? null : weekRaw;
  const requested = parseInt(interaction.fields.getTextInputValue('page'), 10);
  const payload = buildLeaderboardPage(
    interaction.guildId,
    type,
    season,
    week,
    Number.isFinite(requested) ? requested : 1,
    ownerId,
  );
  if (!payload) {
    await interaction.reply({ content: 'That leaderboard is no longer available.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.isFromMessage()) {
    await interaction.update({ embeds: payload.embeds, components: payload.components });
  } else {
    await interaction.reply({ embeds: payload.embeds, components: payload.components });
  }
}
