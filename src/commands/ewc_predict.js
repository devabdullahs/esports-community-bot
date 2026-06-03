import { SlashCommandBuilder, InteractionContextType, MessageFlags, EmbedBuilder } from 'discord.js';
import {
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
    const offset = (page - 1) * PAGE_SIZE;
    if (type === 'weekly') {
      const weekKey = interaction.options.getString('week');
      if (!weekKey) {
        await interaction.reply({ content: '❌ Choose a `week` for the weekly leaderboard.', flags: MessageFlags.Ephemeral });
        return;
      }
      const round = getEwcWeek(interaction.guildId, seasonYear, weekKey);
      if (!round) {
        await interaction.reply({ content: `❌ Week \`${weekKey}\` does not exist.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const rows = weeklyLeaderboard(round.id, PAGE_SIZE, offset);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`EWC Weekly Predictions — ${round.label || round.week_key}`)
            .setDescription(leaderboardLines(rows, offset)),
        ],
      });
      return;
    }
    if (type === 'season') {
      const rows = seasonLeaderboard(interaction.guildId, seasonYear, PAGE_SIZE, offset);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`EWC ${seasonYear} Season Predictions`)
            .setDescription(leaderboardLines(rows, offset)),
        ],
      });
      return;
    }
    const rows = overallLeaderboard(interaction.guildId, seasonYear, PAGE_SIZE, offset);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`EWC ${seasonYear} Prediction Leaderboard`)
          .setDescription(leaderboardLines(rows, offset)),
      ],
    });
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
