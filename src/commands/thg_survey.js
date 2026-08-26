import {
  AttachmentBuilder,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { sendAuditLog } from '../lib/auditLog.js';
import {
  botChannelPermissionMessage,
  EMBED_BOARD_PERMISSIONS,
  missingBotChannelPermissions,
} from '../lib/botPermissions.js';
import {
  getSurveyResponse,
  listSurveyResponses,
  recordSurveyResponse,
} from '../db/thgSurveyResponses.js';
import {
  aggregateResponses,
  parseSurveySubmission,
  respondentHash,
  responsesToCsv,
  THG_SURVEY,
  THG_SURVEY_DUPLICATE_AR,
  THG_SURVEY_ERROR_AR,
  THG_SURVEY_REQUIRED_AR,
  THG_SURVEY_SUCCESS_AR,
  THG_SURVEY_UNAVAILABLE_AR,
} from '../lib/thgSurvey.js';
import {
  buildSurveyAnnouncement,
  buildSurveyModal,
  SURVEY_MODAL_CUSTOM_ID,
  SURVEY_START_CUSTOM_ID,
} from '../lib/thgSurveyComponents.js';
import {
  deliverSurveyNotifications,
  surveyConfigStatus,
  testSurveyNotifications,
} from '../lib/thgSurveyNotifications.js';

// The Hacking Games gamer survey.
//
// Member-facing surfaces (button, modal, confirmations) are Arabic; every
// admin/THG surface below is English. Interaction routing keys off the
// "thg_survey:" custom-id prefix, which is why it must equal this command name
// (see src/events/interactionCreate.js).

const ADMIN_PERMISSION = PermissionFlagsBits.ManageGuild;
const DISCORD_MESSAGE_CAP = 2000;

export const data = new SlashCommandBuilder()
  .setName('thg_survey')
  .setDescription('Manage the The Hacking Games gamer survey.')
  .addSubcommand((s) =>
    s
      .setName('post')
      .setDescription('Post the survey card so members can answer it.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post it (defaults to this channel)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      ),
  )
  .addSubcommand((s) => s.setName('results').setDescription('Show aggregate survey results (no respondent identity).'))
  .addSubcommand((s) => s.setName('export').setDescription('Export the survey responses as a CSV file.'))
  .addSubcommand((s) =>
    s.setName('test_notifications').setDescription('Check the survey log channel and THG DM destinations.'),
  )
  .setDefaultMemberPermissions(ADMIN_PERMISSION)
  .setContexts(InteractionContextType.Guild);

// setDefaultMemberPermissions is enforced by Discord, but a guild admin can
// override it per-command in Server Settings. Survey data is not something to
// expose on a misconfiguration, so the gate is re-checked here.
export function hasSurveyAdminPermission(interaction) {
  return Boolean(interaction.memberPermissions?.has(ADMIN_PERMISSION));
}

function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

function configSummaryLines(status) {
  const state = (value, envVar) => (value === 'configured' ? '✅ set' : `⚠️ ${value} (${envVar})`);
  return [
    `- Response de-duplication secret: ${state(status.hashSecret, 'SURVEY_HASH_SECRET')}`,
    `- Survey log channel: ${state(status.logChannel, 'THG_SURVEY_LOG_CHANNEL_ID')}`,
    `- THG DM recipient: ${state(status.thgRecipient, 'THG_SURVEY_RECIPIENT_USER_ID')}`,
  ];
}

async function postSurvey(interaction) {
  const status = surveyConfigStatus();
  if (!status.canAcceptResponses) {
    const detail = status.definitionProblems.length
      ? `Survey definition is invalid:\n${status.definitionProblems.map((p) => `- ${p}`).join('\n')}`
      : 'SURVEY_HASH_SECRET is not configured, so submissions cannot be de-duplicated.';
    await interaction.reply(ephemeral(`❌ The survey cannot be posted yet.\n${detail}`));
    return;
  }

  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel?.isTextBased?.()) {
    await interaction.reply(ephemeral('❌ Pick a text or announcement channel.'));
    return;
  }
  const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
  if (missing.length) {
    await interaction.reply(ephemeral(botChannelPermissionMessage(channel, missing)));
    return;
  }

  const message = await channel.send({
    ...buildSurveyAnnouncement(),
    flags: MessageFlags.IsComponentsV2,
  });

  const warnings = [];
  if (status.logChannel !== 'configured') warnings.push('the survey log channel is not configured');
  if (status.thgRecipient !== 'configured') warnings.push('the THG DM recipient is not configured');

  await interaction.reply(
    ephemeral(
      [
        `✅ Survey posted in ${channel}.`,
        `-# Version \`${THG_SURVEY.version}\` · ${message.url}`,
        warnings.length ? `⚠️ Responses will still be saved, but ${warnings.join(' and ')}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  );

  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'THG Survey Posted',
    actor: interaction.user,
    target: `${channel} (${channel.id})`,
    details: `Version: ${THG_SURVEY.version}\nMessage: ${message.url}`,
    color: 'config',
  });
}

function formatResults(summary) {
  const lines = [
    `**${THG_SURVEY.title.en}**`,
    `-# Version \`${summary.version}\` · **${summary.total}** response${summary.total === 1 ? '' : 's'}`,
  ];
  if (!summary.total) {
    lines.push('', 'No responses yet.');
    return lines.join('\n');
  }

  for (const [index, question] of summary.questions.entries()) {
    lines.push('', `**Q${index + 1} — ${question.question}**`);
    if (question.type === 'text') {
      // Q4 collects contact details. Counts only here; the values live in the
      // CSV export, which goes to authorized admins on request.
      lines.push(`-# Free text · ${question.answered} of ${summary.total} answered (${question.answeredPercent}%)`);
      if (question.sensitive) lines.push('-# Contact details are only in `/thg_survey export`.');
      continue;
    }
    if (question.type === 'checkbox_group') {
      lines.push(`-# Multi-select · ${question.responders} respondent(s); percentages are of respondents.`);
    }
    for (const option of question.options) {
      lines.push(`• ${option.label} — **${option.count}** (${option.percent}%)`);
    }
  }
  return lines.join('\n');
}

async function showResults(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const responses = await listSurveyResponses({
    guildId: interaction.guildId,
    surveyVersion: THG_SURVEY.version,
  });
  const text = formatResults(aggregateResponses(responses));

  if (text.length <= DISCORD_MESSAGE_CAP) {
    await interaction.editReply({ content: text });
    return;
  }
  // Paginating a summary would split the question groups; a single attachment
  // keeps it readable and still ephemeral.
  await interaction.editReply({
    content: `${THG_SURVEY.title.en} — ${responses.length} response(s). Summary attached.`,
    files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `thg-survey-results-${THG_SURVEY.version}.md` })],
  });
}

async function exportResponses(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const responses = await listSurveyResponses({
    guildId: interaction.guildId,
    surveyVersion: THG_SURVEY.version,
  });
  if (!responses.length) {
    await interaction.editReply({ content: 'No responses to export yet.' });
    return;
  }

  // Built in memory and attached directly — nothing is written to disk, so
  // there is no temporary file to clean up.
  const csv = Buffer.from(responsesToCsv(responses), 'utf8');
  await interaction.editReply({
    content:
      `${THG_SURVEY.title.en} — ${responses.length} response(s), version \`${THG_SURVEY.version}\`.\n` +
      '-# Contains answers only: no Discord identity and no respondent hash.',
    files: [
      new AttachmentBuilder(csv, { name: `thg-survey-${THG_SURVEY.version}-${responses.length}-responses.csv` }),
    ],
  });

  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'THG Survey Exported',
    actor: interaction.user,
    target: THG_SURVEY.version,
    details: `Exported ${responses.length} response(s) as CSV.`,
    color: 'config',
  });
}

async function runNotificationTest(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = surveyConfigStatus();
  const result = await testSurveyNotifications(interaction.client, {
    requestedBy: `${interaction.user.username} (${interaction.user.id})`,
  });

  const line = (label, outcome) =>
    outcome.ok ? `- ${label}: ✅ delivered` : `- ${label}: ❌ ${outcome.error || 'failed'}`;

  await interaction.editReply({
    content: [
      '**THG survey notification test**',
      line('Log channel', result.logChannel),
      line('THG DM', result.thgDm),
      '',
      '**Configuration**',
      ...configSummaryLines(status),
    ].join('\n'),
  });
}

export async function execute(interaction) {
  if (!hasSurveyAdminPermission(interaction)) {
    await interaction.reply(ephemeral('You need the Manage Server permission to use this command.'));
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'post') return postSurvey(interaction);
  if (sub === 'results') return showResults(interaction);
  if (sub === 'export') return exportResponses(interaction);
  if (sub === 'test_notifications') return runNotificationTest(interaction);
  await interaction.reply(ephemeral('Unknown subcommand.'));
}

export async function handleComponent(interaction) {
  if (interaction.customId !== SURVEY_START_CUSTOM_ID) return;

  const status = surveyConfigStatus();
  if (!status.canAcceptResponses) {
    logger.error(
      `[thg-survey] refusing a submission: secret=${status.hashSecret}, ` +
        `definition problems=${status.definitionProblems.length}`,
    );
    await interaction.reply(ephemeral(THG_SURVEY_UNAVAILABLE_AR));
    return;
  }

  // Checked before the modal opens so a returning member does not fill it in for
  // nothing. The authoritative check is still the unique index on submit.
  try {
    const existing = await getSurveyResponse({
      guildId: interaction.guildId,
      surveyVersion: THG_SURVEY.version,
      respondentHash: respondentHash(config.thgSurvey.hashSecret, interaction.guildId, interaction.user.id),
    });
    if (existing) {
      await interaction.reply(ephemeral(THG_SURVEY_DUPLICATE_AR));
      return;
    }
  } catch (error) {
    logger.error(`[thg-survey] duplicate pre-check failed: ${error.message}`);
    await interaction.reply(ephemeral(THG_SURVEY_ERROR_AR));
    return;
  }

  // showModal must be the FIRST response to the interaction, so nothing above
  // may defer or reply on the success path.
  await interaction.showModal(buildSurveyModal());
}

export async function handleModal(interaction) {
  if (interaction.customId !== SURVEY_MODAL_CUSTOM_ID) return;

  const status = surveyConfigStatus();
  if (!status.canAcceptResponses) {
    await interaction.reply(ephemeral(THG_SURVEY_UNAVAILABLE_AR));
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Parsed from the modal component tree, where each Label (type 18) wraps its
  // radio group / checkbox group / text input.
  const parsed = parseSurveySubmission(interaction.components);
  if (!parsed.ok) {
    logger.warn(`[thg-survey] rejected a submission: ${parsed.errors.join(', ')}`);
    await interaction.editReply({ content: THG_SURVEY_REQUIRED_AR });
    return;
  }

  let saved;
  try {
    saved = await recordSurveyResponse({
      guildId: interaction.guildId,
      surveyVersion: THG_SURVEY.version,
      respondentHash: respondentHash(config.thgSurvey.hashSecret, interaction.guildId, interaction.user.id),
      answers: parsed.answers,
    });
  } catch (error) {
    logger.error(`[thg-survey] failed to store a response: ${error.message}`);
    await interaction.editReply({ content: THG_SURVEY_ERROR_AR });
    return;
  }

  if (!saved.created) {
    await interaction.editReply({ content: THG_SURVEY_DUPLICATE_AR });
    return;
  }

  // The member is answered first: the two staff notifications are secondary and
  // must never hold up — or fail — a submission that is already committed.
  await interaction.editReply({ content: THG_SURVEY_SUCCESS_AR });
  await deliverSurveyNotifications(interaction.client, saved.response).catch((error) =>
    logger.error(
      `[thg-survey] notification delivery failed for response #${saved.response.responseNumber}: ${error.message}`,
    ),
  );
}
