import { config } from '../config.js';
import { logger } from './logger.js';
import { markSurveyNotificationSent } from '../db/thgSurveyResponses.js';
import { THG_SURVEY, validateSurveyDefinition } from './thgSurvey.js';
import { buildLogEmbed, buildNotificationTestEmbed, buildThgEmbed } from './thgSurveyComponents.js';

// Delivery of the two ENGLISH staff-facing notifications for each survey
// response: an internal log-channel embed and a DM to THG's Discord account.
//
// Both are strictly secondary. The response is already committed before either
// is attempted, and every failure here is logged and swallowed — a member must
// never be told their answer failed because THG has DMs closed.

const SNOWFLAKE = /^\d{17,20}$/;

function snowflakeState(value) {
  if (!value) return 'missing';
  return SNOWFLAKE.test(String(value)) ? 'configured' : 'invalid';
}

/** Configuration health for admin surfaces and startup logging. */
export function surveyConfigStatus(settings = config.thgSurvey, survey = THG_SURVEY) {
  const definitionProblems = validateSurveyDefinition(survey);
  return {
    hashSecret: settings?.hashSecret ? 'configured' : 'missing',
    logChannel: snowflakeState(settings?.logChannelId),
    thgRecipient: snowflakeState(settings?.recipientUserId),
    definitionProblems,
    // The survey can only ACCEPT answers when it can de-duplicate them.
    canAcceptResponses: Boolean(settings?.hashSecret) && definitionProblems.length === 0,
  };
}

/** One-line boot warning so a missing destination is visible before going live. */
export function logSurveyConfigWarnings(status = surveyConfigStatus()) {
  for (const problem of status.definitionProblems) {
    logger.error(`[thg-survey] survey definition invalid: ${problem}`);
  }
  if (status.hashSecret !== 'configured') {
    logger.warn('[thg-survey] SURVEY_HASH_SECRET is not set — the survey will refuse submissions.');
  }
  if (status.logChannel !== 'configured') {
    logger.warn(`[thg-survey] THG_SURVEY_LOG_CHANNEL_ID is ${status.logChannel} — response logs are disabled.`);
  }
  if (status.thgRecipient !== 'configured') {
    logger.warn(`[thg-survey] THG_SURVEY_RECIPIENT_USER_ID is ${status.thgRecipient} — THG DMs are disabled.`);
  }
  return status;
}

async function resolveLogChannel(client, channelId) {
  if (snowflakeState(channelId) !== 'configured') {
    throw new Error('Log channel is not configured.');
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) throw new Error('Configured log channel is not a text channel.');
  return channel;
}

async function resolveThgUser(client, userId) {
  if (snowflakeState(userId) !== 'configured') {
    throw new Error('THG recipient is not configured.');
  }
  // Never assume the account is cached — it is usually not a guild member.
  return client.users.fetch(userId);
}

async function sendSurveyLog(client, response, settings = config.thgSurvey) {
  const channel = await resolveLogChannel(client, settings?.logChannelId);
  const message = await channel.send({ embeds: [buildLogEmbed(response)] });
  await markSurveyNotificationSent({ id: response.id, channel: 'logChannel', messageId: message.id });
  return message.id;
}

async function sendThgNotification(client, response, settings = config.thgSurvey) {
  const user = await resolveThgUser(client, settings?.recipientUserId);
  const message = await user.send({ embeds: [buildThgEmbed(response)] });
  await markSurveyNotificationSent({ id: response.id, channel: 'thgDm', messageId: message.id });
  return message.id;
}

/**
 * Fire both notifications for a freshly-stored response.
 *
 * Callers MUST only reach this for a newly created row (see recordSurveyResponse):
 * a rejected duplicate never gets here, which is what stops a replayed
 * interaction from producing a second THG DM. Already-delivered notifications
 * are skipped via the stored receipt.
 */
export async function deliverSurveyNotifications(client, response, settings = config.thgSurvey) {
  const jobs = [];
  if (!response.notifications?.logChannel?.sentAt) {
    jobs.push(['logChannel', () => sendSurveyLog(client, response, settings)]);
  }
  if (!response.notifications?.thgDm?.sentAt) {
    jobs.push(['thgDm', () => sendThgNotification(client, response, settings)]);
  }

  const outcomes = await Promise.allSettled(jobs.map(([, run]) => run()));
  const result = {};
  for (const [index, [name]] of jobs.entries()) {
    const outcome = outcomes[index];
    result[name] = { ok: outcome.status === 'fulfilled', error: outcome.reason?.message || null };
    if (outcome.status === 'rejected') {
      // Response number, not respondent — survey logs never carry identity.
      logger.warn(
        `[thg-survey] ${name} notification failed for response #${response.responseNumber}: ${outcome.reason?.message}`,
      );
    }
  }
  return result;
}

/** /thg_survey test_notifications — probe both destinations without faking data. */
export async function testSurveyNotifications(client, { requestedBy = null, settings = config.thgSurvey } = {}) {
  const embed = buildNotificationTestEmbed({ requestedBy });
  const probe = async (send) => {
    try {
      await send();
      return { ok: true, error: null };
    } catch (error) {
      logger.warn(`[thg-survey] notification test failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  };

  return {
    logChannel: await probe(async () => {
      const channel = await resolveLogChannel(client, settings?.logChannelId);
      await channel.send({ embeds: [embed] });
    }),
    thgDm: await probe(async () => {
      const user = await resolveThgUser(client, settings?.recipientUserId);
      await user.send({ embeds: [embed] });
    }),
  };
}
