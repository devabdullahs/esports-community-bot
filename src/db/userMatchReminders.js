import { all, get } from './client.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function validMatchId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validDiscordUserId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertReminderInput({ discordUserId, matchId }) {
  if (!validDiscordUserId(discordUserId) || !validMatchId(matchId)) {
    throw new Error('A Discord user id and positive match id are required.');
  }
}

export async function getMatchReminderTarget(matchId) {
  if (!validMatchId(matchId)) throw new Error('Invalid match id.');
  return get('SELECT id, status FROM matches WHERE id = $1', [matchId]);
}

// A canceled reminder remains as one row for its user/match pair. Recreating
// it clears canceled_at while preserving the original creation time when it
// was already active, which makes repeat POSTs naturally idempotent.
export async function upsertMatchReminder({ discordUserId, matchId }) {
  assertReminderInput({ discordUserId, matchId });
  const createdAt = nowText();
  return get(
    `INSERT INTO user_match_reminders (discord_user_id, match_id, created_at, canceled_at)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (discord_user_id, match_id) DO UPDATE SET
       created_at = CASE
         WHEN user_match_reminders.canceled_at IS NULL THEN user_match_reminders.created_at
         ELSE excluded.created_at
       END,
       canceled_at = NULL
     RETURNING *`,
    [discordUserId, matchId, createdAt],
  );
}

export async function cancelMatchReminder({ discordUserId, matchId }) {
  assertReminderInput({ discordUserId, matchId });
  return get(
    `UPDATE user_match_reminders
     SET canceled_at = $1
     WHERE discord_user_id = $2 AND match_id = $3 AND canceled_at IS NULL
     RETURNING *`,
    [nowText(), discordUserId, matchId],
  );
}

export async function listActiveReminderMatchIdsForUser(discordUserId, matchIds = null) {
  if (!validDiscordUserId(discordUserId)) throw new Error('A Discord user id is required.');
  const ids = Array.isArray(matchIds)
    ? [...new Set(matchIds.filter(validMatchId))].slice(0, 500)
    : null;
  if (ids && !ids.length) return [];
  const matchFilter = ids ? ` AND match_id IN (${ids.map((_, index) => `$${index + 2}`).join(', ')})` : '';
  const rows = await all(
    `SELECT match_id FROM user_match_reminders
     WHERE discord_user_id = $1 AND canceled_at IS NULL${matchFilter}
     ORDER BY match_id ASC`,
    [discordUserId, ...(ids || [])],
  );
  return rows.map((row) => Number(row.match_id));
}

export async function listActiveReminderUserIdsForMatch(matchId) {
  if (!validMatchId(matchId)) throw new Error('Invalid match id.');
  const rows = await all(
    `SELECT discord_user_id FROM user_match_reminders
     WHERE match_id = $1 AND canceled_at IS NULL
     ORDER BY discord_user_id ASC`,
    [matchId],
  );
  return rows.map((row) => row.discord_user_id);
}
