import { all, get, run, transaction } from './client.js';

// Storage for the THG gamer survey. Deliberately minimal: the raw Discord user
// id is NEVER written — `respondent_hash` (HMAC of guild+user, see
// src/lib/thgSurvey.js) exists only so one member cannot answer twice.

function parseAnswers(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    surveyVersion: row.survey_version,
    responseNumber: row.response_number,
    answers: parseAnswers(row.answers_json),
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    notifications: {
      logChannel: { messageId: row.log_message_id || null, sentAt: row.log_sent_at || null },
      thgDm: { messageId: row.thg_dm_message_id || null, sentAt: row.thg_dm_sent_at || null },
    },
  };
}

/**
 * Persist one response. Duplicate protection happens HERE, before any
 * notification is attempted, so a replayed interaction can never produce a
 * second THG DM.
 * @returns {Promise<{created: boolean, response: object}>}
 */
export async function recordSurveyResponse({
  guildId,
  surveyVersion,
  respondentHash,
  answers,
  submittedAt = Math.floor(Date.now() / 1000),
}) {
  return transaction(async (tx) => {
    const existing = await tx.get(
      `SELECT * FROM thg_survey_responses
       WHERE guild_id = $1 AND survey_version = $2 AND respondent_hash = $3`,
      [guildId, surveyVersion, respondentHash],
    );
    if (existing) return { created: false, response: hydrate(existing) };

    const counted = await tx.get(
      'SELECT COUNT(*) AS c FROM thg_survey_responses WHERE guild_id = $1 AND survey_version = $2',
      [guildId, surveyVersion],
    );
    const responseNumber = Number(counted?.c || 0) + 1;

    const inserted = await tx.run(
      `INSERT INTO thg_survey_responses
         (guild_id, survey_version, respondent_hash, response_number, answers_json, submitted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (guild_id, survey_version, respondent_hash) DO NOTHING`,
      [guildId, surveyVersion, respondentHash, responseNumber, JSON.stringify(answers ?? {}), submittedAt, submittedAt],
    );

    const row = await tx.get(
      `SELECT * FROM thg_survey_responses
       WHERE guild_id = $1 AND survey_version = $2 AND respondent_hash = $3`,
      [guildId, surveyVersion, respondentHash],
    );
    // changes === 0 means a concurrent submission won the unique index.
    return { created: (inserted.changes || 0) > 0, response: hydrate(row) };
  });
}

export async function getSurveyResponse({ guildId, surveyVersion, respondentHash }) {
  return hydrate(
    await get(
      `SELECT * FROM thg_survey_responses
       WHERE guild_id = $1 AND survey_version = $2 AND respondent_hash = $3`,
      [guildId, surveyVersion, respondentHash],
    ),
  );
}

export async function listSurveyResponses({ guildId, surveyVersion }) {
  const rows = await all(
    `SELECT * FROM thg_survey_responses
     WHERE guild_id = $1 AND survey_version = $2
     ORDER BY submitted_at ASC, id ASC`,
    [guildId, surveyVersion],
  );
  return rows.map(hydrate);
}

const NOTIFICATION_COLUMNS = {
  logChannel: { messageId: 'log_message_id', sentAt: 'log_sent_at' },
  thgDm: { messageId: 'thg_dm_message_id', sentAt: 'thg_dm_sent_at' },
};

/**
 * Record that a notification for this response was delivered. The
 * `sentAt IS NULL` guard makes a re-run of the notification step a no-op rather
 * than an overwrite, so the stored state stays the FIRST successful delivery.
 */
export async function markSurveyNotificationSent({
  id,
  channel,
  messageId = null,
  sentAt = Math.floor(Date.now() / 1000),
}) {
  const columns = NOTIFICATION_COLUMNS[channel];
  if (!columns) throw new Error(`Unknown survey notification channel: ${channel}`);
  // Column names come from the fixed map above, so interpolation here is safe.
  const info = await run(
    `UPDATE thg_survey_responses
     SET ${columns.messageId} = $1, ${columns.sentAt} = $2, updated_at = $3
     WHERE id = $4 AND ${columns.sentAt} IS NULL`,
    [messageId, sentAt, sentAt, id],
  );
  return (info.changes || 0) > 0;
}
