import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType } from 'discord.js';
import {
  clearSeasonPredictionScores,
  clearWeeklyPredictionScores,
  deleteEwcWeek,
  getEwcSeason,
  getEwcWeek,
  listEwcWeeks,
  listSeasonPredictions,
  listWeeklyPredictions,
  markEwcSeasonScored,
  markEwcWeekScored,
  reopenEwcSeason,
  reopenEwcWeek,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  setEwcSeasonStatus,
  setEwcWeekSnapshot,
  setEwcWeekStatus,
  upsertEwcSeason,
  upsertEwcWeek,
} from '../db/ewcPredictions.js';
import { config } from '../config.js';
import {
  setEwcPredictionsChannel,
  setEwcPredictionsLeaderboard,
  setEwcPredictionsMentionsLeaderboard,
} from '../db/settings.js';
import { updateEwcPredictionLeaderboard } from '../jobs/ewcPredictions.js';
import { db } from '../db/index.js';
import { sendAuditLog } from '../lib/auditLog.js';
import {
  formatTimestamp,
  generateEwcWeekWindows,
  parsePredictionDate,
  scoreSeasonPrediction,
  scoreWeeklyPrediction,
} from '../lib/ewcPredictions.js';
import { fetchEwcClubStandings, fetchEwcEventSchedule } from '../services/liquipedia.js';
import {
  botChannelPermissionMessage,
  EMBED_BOARD_PERMISSIONS,
  missingBotChannelPermissions,
} from '../lib/botPermissions.js';

const DEFAULT_SEASON = '2026';

export const data = new SlashCommandBuilder()
  .setName('ewc_admin')
  .setDescription('Manage EWC community prediction rounds.')
  .addSubcommand((s) =>
    s
      .setName('set_channel')
      .setDescription('Set the public channel for EWC prediction result announcements.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('set_leaderboard')
      .setDescription('Post one auto-updating public EWC prediction image leaderboard.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('set_mentions_leaderboard')
      .setDescription('Post one auto-updating EWC prediction leaderboard with member mentions for admins.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('generate_weeks')
      .setDescription('Create weekly prediction rounds from the EWC tournament schedule.')
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false))
      .addIntegerOption((o) =>
        o
          .setName('open_before_hours')
          .setDescription('Hours before each week starts to open picks; default 48')
          .setMinValue(0)
          .setMaxValue(336),
      )
      .addIntegerOption((o) =>
        o
          .setName('score_delay_hours')
          .setDescription('Hours after the week ends before scoring; default 24')
          .setMinValue(0)
          .setMaxValue(336),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('create_week')
      .setDescription('Create or update a weekly prediction round.')
      .addStringOption((o) => o.setName('week').setDescription('Week key, e.g. week-1').setRequired(true))
      .addStringOption((o) => o.setName('label').setDescription('Display label, e.g. Week 1').setRequired(true))
      .addStringOption((o) => o.setName('open_at').setDescription('YYYY-MM-DD HH:mm Riyadh time, Unix seconds, or <t:...>'))
      .addStringOption((o) => o.setName('close_at').setDescription('YYYY-MM-DD HH:mm Riyadh time, Unix seconds, or <t:...>'))
      .addIntegerOption((o) =>
        o
          .setName('score_delay_hours')
          .setDescription('Hours to wait after close before scoring; default 24')
          .setMinValue(0)
          .setMaxValue(168),
      )
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('snapshot_week')
      .setDescription('Save the current Club Championship standings as a weekly baseline/final snapshot.')
      .addStringOption((o) => o.setName('week').setDescription('Week key').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Snapshot type')
          .setRequired(true)
          .addChoices({ name: 'Baseline', value: 'baseline' }, { name: 'Final', value: 'final' }),
      )
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('close_week')
      .setDescription('Close a weekly round so picks can no longer be changed.')
      .addStringOption((o) => o.setName('week').setDescription('Week key').setRequired(true))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('reopen_week')
      .setDescription('Reopen a weekly round and clear its scores.')
      .addStringOption((o) => o.setName('week').setDescription('Week key').setRequired(true))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('score_week')
      .setDescription('Score a weekly round from baseline vs final standings.')
      .addStringOption((o) => o.setName('week').setDescription('Week key').setRequired(true))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('delete_week')
      .setDescription('Permanently delete a prediction week and all its picks.')
      .addStringOption((o) => o.setName('week').setDescription('Week key, e.g. week-8').setRequired(true))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false))
      .addBooleanOption((o) => o.setName('confirm').setDescription('Set to True to really delete').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('open_season')
      .setDescription('Open or update the whole-season prediction round.')
      .addStringOption((o) => o.setName('label').setDescription('Display label').setRequired(false))
      .addStringOption((o) => o.setName('open_at').setDescription('YYYY-MM-DD HH:mm Riyadh time, Unix seconds, or <t:...>'))
      .addStringOption((o) => o.setName('close_at').setDescription('YYYY-MM-DD HH:mm Riyadh time, Unix seconds, or <t:...>'))
      .addIntegerOption((o) =>
        o
          .setName('score_delay_hours')
          .setDescription('Hours to wait after close before scoring; default 24')
          .setMinValue(0)
          .setMaxValue(336),
      )
      .addIntegerOption((o) => o.setName('top_size').setDescription('How many season picks count').setMinValue(5).setMaxValue(10))
      .addIntegerOption((o) =>
        o
          .setName('best_weeks')
          .setDescription("Overall counts each member's best N weeks (blank = all weeks)")
          .setMinValue(1)
          .setMaxValue(20),
      )
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('close_season')
      .setDescription('Close the whole-season prediction round.')
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('reopen_season')
      .setDescription('Reopen season predictions and clear season scores.')
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('score_season')
      .setDescription('Score the whole-season prediction round from final standings.')
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('List configured EWC prediction rounds.')
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

function season(interaction) {
  return interaction.options.getString('season') || DEFAULT_SEASON;
}

function parseOptionalDate(interaction, name) {
  const value = interaction.options.getString(name);
  return value ? parsePredictionDate(value) : null;
}

function scoreAfterFromClose(interaction, closeAt) {
  if (!closeAt) return null;
  const delayHours = interaction.options.getInteger('score_delay_hours') ?? config.ewcPredictions.scoreDelayHours;
  return closeAt + delayHours * 3600;
}

async function currentStandings(seasonYear) {
  const data = await fetchEwcClubStandings(seasonYear);
  if (!data.exists || !data.standings.length) {
    throw new Error(`No Club Championship standings are available for ${seasonYear} yet.`);
  }
  return data.standings;
}

async function replyError(interaction, error) {
  const payload = { content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => interaction.followUp(payload));
  else await interaction.reply(payload);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const seasonYear = season(interaction);

  try {
    if (sub === 'set_channel') {
      const channel = interaction.options.getChannel('channel', true);
      const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
      if (missing.length) {
        await interaction.reply({ content: botChannelPermissionMessage(channel, missing), flags: MessageFlags.Ephemeral });
        return;
      }
      setEwcPredictionsChannel(interaction.guildId, channel.id);
      await interaction.reply({ content: `✅ EWC prediction results will be announced in ${channel}.`, flags: MessageFlags.Ephemeral });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Predictions Channel Set',
        actor: interaction.user,
        target: `${channel} (${channel.id})`,
        color: 'config',
      });
      return;
    }

    if (sub === 'set_leaderboard') {
      const channel = interaction.options.getChannel('channel', true);
      const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
      if (missing.length) {
        await interaction.reply({ content: botChannelPermissionMessage(channel, missing), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      setEwcPredictionsLeaderboard(interaction.guildId, { channelId: channel.id, season: seasonYear });
      await updateEwcPredictionLeaderboard(interaction.client, interaction.guildId);
      await interaction.editReply({
        content: `✅ EWC ${seasonYear} prediction leaderboard posted in ${channel} and will keep updating.`,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Leaderboard Set',
        actor: interaction.user,
        target: `${channel} (${channel.id})`,
        details: `Season: ${seasonYear}`,
        color: 'config',
      });
      return;
    }

    if (sub === 'set_mentions_leaderboard') {
      const channel = interaction.options.getChannel('channel', true);
      const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
      if (missing.length) {
        await interaction.reply({ content: botChannelPermissionMessage(channel, missing), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      setEwcPredictionsMentionsLeaderboard(interaction.guildId, { channelId: channel.id, season: seasonYear });
      await updateEwcPredictionLeaderboard(interaction.client, interaction.guildId);
      await interaction.editReply({
        content: `✅ EWC ${seasonYear} admin mentions leaderboard posted in ${channel} and will keep updating.`,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Mentions Leaderboard Set',
        actor: interaction.user,
        target: `${channel} (${channel.id})`,
        details: `Season: ${seasonYear}`,
        color: 'config',
      });
      return;
    }

    if (sub === 'generate_weeks') {
      const openBeforeHours = interaction.options.getInteger('open_before_hours') ?? 48;
      const scoreDelayHours = interaction.options.getInteger('score_delay_hours') ?? config.ewcPredictions.scoreDelayHours;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const schedule = await fetchEwcEventSchedule(Number(seasonYear));
      const weeks = generateEwcWeekWindows(schedule.events, { openBeforeHours, scoreDelayHours });
      if (!weeks.length) throw new Error(`No dated EWC events were found for ${seasonYear}.`);
      for (const week of weeks) {
        upsertEwcWeek({
          guildId: interaction.guildId,
          season: seasonYear,
          weekKey: week.weekKey,
          label: week.label,
          openAt: week.openAt,
          closeAt: week.closeAt,
          scoreAfter: week.scoreAfter,
          createdBy: interaction.user.id,
        });
      }
      const lines = weeks
        .slice(0, 10)
        .map(
          (week) =>
            `- **${week.weekKey}**: ${week.label} - opens ${formatTimestamp(week.openAt)} - locks ${formatTimestamp(week.closeAt)} - scores ${formatTimestamp(week.scoreAfter)}`,
        );
      await interaction.editReply(
        `✅ Generated **${weeks.length}** EWC ${seasonYear} weekly prediction round(s) from ${schedule.events.length} event(s).\n` +
          `Open-before: **${openBeforeHours}h**. Score delay: **${scoreDelayHours}h**.\n\n${lines.join('\n')}`,
      );
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Weeks Generated',
        actor: interaction.user,
        target: `EWC ${seasonYear}`,
        details: `Weeks: ${weeks.length}\nEvents: ${schedule.events.length}\nOpen-before: ${openBeforeHours}h\nScore delay: ${scoreDelayHours}h`,
        color: 'config',
      });
      return;
    }

    if (sub === 'create_week') {
      const weekKey = interaction.options.getString('week', true);
      const label = interaction.options.getString('label', true);
      const closeAt = parseOptionalDate(interaction, 'close_at');
      const round = upsertEwcWeek({
        guildId: interaction.guildId,
        season: seasonYear,
        weekKey,
        label,
        openAt: parseOptionalDate(interaction, 'open_at'),
        closeAt,
        scoreAfter: scoreAfterFromClose(interaction, closeAt),
        createdBy: interaction.user.id,
      });
      await interaction.reply({
        content:
          `✅ Created **${round.label || round.week_key}** for EWC ${round.season}.\n` +
          `Open: ${formatTimestamp(round.open_at)}\nClose: ${formatTimestamp(round.close_at)}\n` +
          `Score after: ${formatTimestamp(round.score_after)}\n` +
          'The bot will auto-snapshot at open time, close picks at close time, and score when standings are available.',
        flags: MessageFlags.Ephemeral,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Week Created',
        actor: interaction.user,
        target: `${round.season} ${round.week_key}`,
        details:
          `Label: ${round.label}\n` +
          `Open: ${formatTimestamp(round.open_at)}\n` +
          `Close: ${formatTimestamp(round.close_at)}\n` +
          `Score after: ${formatTimestamp(round.score_after)}`,
        color: 'config',
      });
      return;
    }

    if (sub === 'snapshot_week') {
      const weekKey = interaction.options.getString('week', true);
      const type = interaction.options.getString('type', true);
      const round = getEwcWeek(interaction.guildId, seasonYear, weekKey);
      if (!round) throw new Error(`Week \`${weekKey}\` does not exist.`);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const standings = await currentStandings(seasonYear);
      setEwcWeekSnapshot(round.id, type, standings);
      await interaction.editReply({
        content: `✅ Saved **${type}** snapshot for **${round.label || round.week_key}** with ${standings.length} clubs.`,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Week Snapshot Saved',
        actor: interaction.user,
        target: `${round.season} ${round.week_key}`,
        details: `Type: ${type}\nRows: ${standings.length}`,
        color: 'config',
      });
      return;
    }

    if (sub === 'close_week') {
      const weekKey = interaction.options.getString('week', true);
      const round = getEwcWeek(interaction.guildId, seasonYear, weekKey);
      if (!round) throw new Error(`Week \`${weekKey}\` does not exist.`);
      setEwcWeekStatus(round.id, 'closed');
      await interaction.reply({ content: `✅ Closed **${round.label || round.week_key}**.`, flags: MessageFlags.Ephemeral });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Week Closed',
        actor: interaction.user,
        target: `${round.season} ${round.week_key}`,
        color: 'config',
      });
      return;
    }

    if (sub === 'reopen_week') {
      const weekKey = interaction.options.getString('week', true);
      const round = getEwcWeek(interaction.guildId, seasonYear, weekKey);
      if (!round) throw new Error(`Week \`${weekKey}\` does not exist.`);
      reopenEwcWeek(round.id);
      clearWeeklyPredictionScores(round.id);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateEwcPredictionLeaderboard(interaction.client, interaction.guildId);
      await interaction.editReply({
        content: `✅ Reopened **${round.label || round.week_key}** and cleared its prediction scores.`,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Week Reopened',
        actor: interaction.user,
        target: `${round.season} ${round.week_key}`,
        details: 'Scores were cleared. Existing picks are preserved.',
        color: 'config',
      });
      return;
    }

    if (sub === 'delete_week') {
      const weekKey = interaction.options.getString('week', true);
      if (!interaction.options.getBoolean('confirm', true)) {
        throw new Error('Deletion not confirmed. Re-run with `confirm: True`.');
      }
      const round = getEwcWeek(interaction.guildId, seasonYear, weekKey);
      if (!round) throw new Error(`Week \`${weekKey}\` does not exist.`);
      if (round.status === 'scored') {
        throw new Error('This week is already scored. Reopen it first if you really want to delete it.');
      }
      const picks = listWeeklyPredictions(round.id).length;
      const result = deleteEwcWeek(round.id);
      await interaction.reply({
        content: `🗑️ Deleted **${round.label || round.week_key}** (${result.predictions} prediction(s) removed).`,
        flags: MessageFlags.Ephemeral,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Week Deleted',
        actor: interaction.user,
        target: `${round.season} ${round.week_key}`,
        details: `Predictions removed: ${picks}`,
        color: 'config',
      });
      return;
    }

    if (sub === 'score_week') {
      const weekKey = interaction.options.getString('week', true);
      const round = getEwcWeek(interaction.guildId, seasonYear, weekKey);
      if (!round) throw new Error(`Week \`${weekKey}\` does not exist.`);
      const baseline = round.baseline || [];
      if (!baseline.length) throw new Error('This week has no baseline snapshot yet.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const final = round.final?.length ? round.final : await currentStandings(seasonYear);
      const predictions = listWeeklyPredictions(round.id);
      let malformed = 0;
      // Wrap all writes in a transaction so a mid-loop crash leaves scores consistent.
      const applyScores = db.transaction(() => {
        for (const prediction of predictions) {
          try {
            const result = scoreWeeklyPrediction(prediction.picks, baseline, final);
            saveWeeklyPredictionScore(interaction.guildId, round.id, prediction.user_id, result.score, result.details);
          } catch (error) {
            malformed += 1;
            saveWeeklyPredictionScore(interaction.guildId, round.id, prediction.user_id, 0, {
              error: error.message,
              picks: prediction.picks,
            });
          }
        }
        markEwcWeekScored(round.id, final);
      });
      applyScores();
      await updateEwcPredictionLeaderboard(interaction.client, interaction.guildId);
      await interaction.editReply({
        content: `✅ Scored **${round.label || round.week_key}** for ${predictions.length} prediction(s).`,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Prediction Week Scored',
        actor: interaction.user,
        target: `${round.season} ${round.week_key}`,
        details: `Predictions scored: ${predictions.length}${malformed ? `\nMalformed rows scored as 0: ${malformed}` : ''}`,
        color: 'success',
      });
      return;
    }

    if (sub === 'open_season') {
      const topSize = interaction.options.getInteger('top_size') || 10;
      const bestWeeks = interaction.options.getInteger('best_weeks');
      const closeAt = parseOptionalDate(interaction, 'close_at');
      const round = upsertEwcSeason({
        guildId: interaction.guildId,
        season: seasonYear,
        label: interaction.options.getString('label') || `EWC ${seasonYear} Season`,
        openAt: parseOptionalDate(interaction, 'open_at'),
        closeAt,
        scoreAfter: scoreAfterFromClose(interaction, closeAt),
        topSize,
        bestWeeks,
        createdBy: interaction.user.id,
      });
      await interaction.reply({
        content:
          `✅ Season prediction round is open for **${round.label || round.season}**.\n` +
          `Open: ${formatTimestamp(round.open_at)}\nClose: ${formatTimestamp(round.close_at)}\n` +
          `Score after: ${formatTimestamp(round.score_after)}\n` +
          `Picks counted: **${round.top_size}**\n` +
          `Overall: ${round.best_weeks ? `each member's **best ${round.best_weeks}** weeks` : '**all** weeks count'}`,
        flags: MessageFlags.Ephemeral,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Season Prediction Opened',
        actor: interaction.user,
        target: round.season,
        details:
          `Top size: ${round.top_size}\n` +
          `Overall best weeks: ${round.best_weeks || 'all'}\n` +
          `Open: ${formatTimestamp(round.open_at)}\n` +
          `Close: ${formatTimestamp(round.close_at)}\n` +
          `Score after: ${formatTimestamp(round.score_after)}`,
        color: 'config',
      });
      return;
    }

    if (sub === 'close_season') {
      const round = getEwcSeason(interaction.guildId, seasonYear);
      if (!round) throw new Error(`No season round exists for ${seasonYear}.`);
      setEwcSeasonStatus(interaction.guildId, seasonYear, 'closed');
      await interaction.reply({ content: `✅ Closed EWC ${seasonYear} season predictions.`, flags: MessageFlags.Ephemeral });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Season Prediction Closed',
        actor: interaction.user,
        target: seasonYear,
        color: 'config',
      });
      return;
    }

    if (sub === 'reopen_season') {
      const round = getEwcSeason(interaction.guildId, seasonYear);
      if (!round) throw new Error(`No season round exists for ${seasonYear}.`);
      reopenEwcSeason(interaction.guildId, seasonYear);
      clearSeasonPredictionScores(interaction.guildId, seasonYear);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateEwcPredictionLeaderboard(interaction.client, interaction.guildId);
      await interaction.editReply({
        content: `✅ Reopened EWC ${seasonYear} season predictions and cleared season scores.`,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Season Prediction Reopened',
        actor: interaction.user,
        target: seasonYear,
        details: 'Season scores were cleared. Existing picks are preserved.',
        color: 'config',
      });
      return;
    }

    if (sub === 'score_season') {
      const round = getEwcSeason(interaction.guildId, seasonYear);
      if (!round) throw new Error(`No season round exists for ${seasonYear}.`);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const final = await currentStandings(seasonYear);
      const predictions = listSeasonPredictions(interaction.guildId, seasonYear);
      let malformed = 0;
      // Wrap all writes in a transaction so a mid-loop crash leaves scores consistent.
      const applyScores = db.transaction(() => {
        for (const prediction of predictions) {
          try {
            const result = scoreSeasonPrediction(prediction.picks, final, round.top_size);
            saveSeasonPredictionScore(interaction.guildId, seasonYear, prediction.user_id, result.score, result.details);
          } catch (error) {
            malformed += 1;
            saveSeasonPredictionScore(interaction.guildId, seasonYear, prediction.user_id, 0, {
              error: error.message,
              picks: prediction.picks,
            });
          }
        }
        markEwcSeasonScored(interaction.guildId, seasonYear, final);
      });
      applyScores();
      await updateEwcPredictionLeaderboard(interaction.client, interaction.guildId);
      await interaction.editReply({
        content: `✅ Scored EWC ${seasonYear} season predictions for ${predictions.length} member(s).`,
      });
      await sendAuditLog(interaction.client, interaction.guildId, {
        action: 'EWC Season Prediction Scored',
        actor: interaction.user,
        target: seasonYear,
        details: `Predictions scored: ${predictions.length}${malformed ? `\nMalformed rows scored as 0: ${malformed}` : ''}`,
        color: 'success',
      });
      return;
    }

    if (sub === 'list') {
      const weeks = listEwcWeeks(interaction.guildId, seasonYear);
      const seasonRound = getEwcSeason(interaction.guildId, seasonYear);
      const now = Math.floor(Date.now() / 1000);
      let needsBaseline = 0;
      const lines = weeks.length
        ? weeks.map((w) => {
            const hasBaseline = w.baseline?.length;
            // A week past its lock time with no baseline → weekly scoring would be inaccurate.
            const lateMissing = !hasBaseline && w.status !== 'scored' && w.close_at && now >= w.close_at;
            if (lateMissing) needsBaseline += 1;
            const snap = `baseline ${hasBaseline ? '✓' : '✗'}${w.final?.length ? ' · final ✓' : ''}`;
            const warn = lateMissing ? ' — ⚠️ baseline not captured' : '';
            return `• **${w.week_key}** — ${w.label || 'No label'} — \`${w.status}\` — ${snap}${warn}`;
          })
        : ['No weekly rounds configured.'];
      const seasonLine = seasonRound
        ? `Season: **${seasonRound.label || seasonRound.season}** — \`${seasonRound.status}\` — top ${seasonRound.top_size} — overall: ${seasonRound.best_weeks ? `best ${seasonRound.best_weeks} weeks` : 'all weeks'}`
        : 'Season: not configured';
      const warning = needsBaseline
        ? `\n\n⚠️ **${needsBaseline} week(s) are past their lock time with no baseline captured.** ` +
          'Run `/ewc_admin snapshot_week type:baseline` for each so weekly scoring stays accurate.'
        : '';
      await interaction.reply({
        content: `## EWC ${seasonYear} Prediction Rounds\n${seasonLine}\n\n${lines.join('\n')}${warning}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    await replyError(interaction, error);
  }
}
