import { randomBytes, randomUUID } from 'node:crypto';

import { all, dbDriver, get, run, transaction } from './client.js';
import { overallLeaderboardForUsers } from './ewcPredictions.js';

export const MAX_PREDICTION_LEAGUES_PER_MEMBER = 12;
export const MAX_PREDICTION_LEAGUE_MEMBERS = 50;
export const MAX_PREDICTION_LEAGUE_NAME_LENGTH = 60;
export const MAX_PREDICTION_LEAGUE_INVITE_LENGTH = 64;

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function changes(result) {
  return result?.changes ?? result?.rowCount ?? 0;
}

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name && name.length <= MAX_PREDICTION_LEAGUE_NAME_LENGTH ? name : null;
}

function normalizeInviteCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^[A-Za-z0-9_-]{20,64}$/.test(code) ? code : null;
}

function inviteCode() {
  return randomBytes(24).toString('base64url');
}

function hydrateLeague(row, viewerUserId) {
  if (!row) return null;
  const isOwner = row.owner_user_id === viewerUserId;
  return {
    id: row.id,
    guildId: row.guild_id,
    season: row.season,
    name: row.name,
    ownerUserId: row.owner_user_id,
    memberCount: Number(row.member_count || 0),
    isOwner,
    inviteCode: isOwner ? row.invite_code : null,
    createdAt: row.created_at,
  };
}

async function scopedLeague(client, { guildId, season, userId, leagueId }) {
  const row = await client.get(
    `SELECT l.*, COUNT(all_members.user_id) AS member_count
     FROM ewc_prediction_leagues l
     JOIN ewc_prediction_league_members viewer
       ON viewer.league_id = l.id AND viewer.user_id = $1
     LEFT JOIN ewc_prediction_league_members all_members ON all_members.league_id = l.id
     WHERE l.id = $2 AND l.guild_id = $3 AND l.season = $4 AND l.archived_at IS NULL
     GROUP BY l.id`,
    [userId, leagueId, guildId, season],
  );
  return hydrateLeague(row, userId);
}

async function activeLeagueCountForMember(client, { guildId, season, userId }) {
  const row = await client.get(
    `SELECT COUNT(*) AS count
     FROM ewc_prediction_league_members m
     JOIN ewc_prediction_leagues l ON l.id = m.league_id
     WHERE m.user_id = $1 AND l.guild_id = $2 AND l.season = $3 AND l.archived_at IS NULL`,
    [userId, guildId, season],
  );
  return Number(row?.count || 0);
}

export async function createPredictionLeague({ guildId, season, ownerUserId, name }) {
  const safeName = normalizeName(name);
  if (!safeName) throw new TypeError('A valid league name is required.');

  return transaction(async (client) => {
    if ((await activeLeagueCountForMember(client, { guildId, season, userId: ownerUserId })) >= MAX_PREDICTION_LEAGUES_PER_MEMBER) {
      return { created: false, reason: 'league_limit', league: null };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = randomUUID();
      const code = inviteCode();
      try {
        await client.run(
          `INSERT INTO ewc_prediction_leagues
             (id, guild_id, season, name, owner_user_id, invite_code, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, guildId, season, safeName, ownerUserId, code, nowText()],
        );
      } catch (error) {
        if (/unique|duplicate|23505/i.test(String(error?.message || error))) continue;
        throw error;
      }
      await client.run(
        `INSERT INTO ewc_prediction_league_members (league_id, user_id, joined_at)
         VALUES ($1, $2, $3)`,
        [id, ownerUserId, nowText()],
      );
      return {
        created: true,
        reason: null,
        league: await scopedLeague(client, { guildId, season, userId: ownerUserId, leagueId: id }),
      };
    }

    throw new Error('Could not generate a unique league invite code.');
  });
}

export async function listPredictionLeaguesForMember({ guildId, season, userId, limit = MAX_PREDICTION_LEAGUES_PER_MEMBER }) {
  const safeLimit = Math.max(1, Math.min(MAX_PREDICTION_LEAGUES_PER_MEMBER, Math.floor(Number(limit) || 0)));
  const rows = await all(
    `SELECT l.*, COUNT(all_members.user_id) AS member_count
     FROM ewc_prediction_leagues l
     JOIN ewc_prediction_league_members viewer
       ON viewer.league_id = l.id AND viewer.user_id = $1
     LEFT JOIN ewc_prediction_league_members all_members ON all_members.league_id = l.id
     WHERE l.guild_id = $2 AND l.season = $3 AND l.archived_at IS NULL
     GROUP BY l.id
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $4`,
    [userId, guildId, season, safeLimit],
  );
  return rows.map((row) => hydrateLeague(row, userId));
}

export async function getPredictionLeagueForMember({ guildId, season, userId, leagueId }) {
  const client = { get };
  return scopedLeague(client, { guildId, season, userId, leagueId });
}

export async function joinPredictionLeague({ guildId, season, userId, inviteCode: rawInviteCode }) {
  const code = normalizeInviteCode(rawInviteCode);
  if (!code) return { joined: false, reason: 'invalid_invite', league: null };

  return transaction(async (client) => {
    const suffix = dbDriver() === 'postgres' ? ' FOR UPDATE' : '';
    const league = await client.get(
      `SELECT * FROM ewc_prediction_leagues
       WHERE guild_id = $1 AND season = $2 AND invite_code = $3 AND archived_at IS NULL${suffix}`,
      [guildId, season, code],
    );
    if (!league) return { joined: false, reason: 'invalid_invite', league: null };

    const existing = await client.get(
      'SELECT 1 FROM ewc_prediction_league_members WHERE league_id = $1 AND user_id = $2',
      [league.id, userId],
    );
    if (existing) {
      return {
        joined: false,
        reason: 'already_member',
        league: await scopedLeague(client, { guildId, season, userId, leagueId: league.id }),
      };
    }

    if ((await activeLeagueCountForMember(client, { guildId, season, userId })) >= MAX_PREDICTION_LEAGUES_PER_MEMBER) {
      return { joined: false, reason: 'league_limit', league: null };
    }
    const memberCount = await client.get(
      'SELECT COUNT(*) AS count FROM ewc_prediction_league_members WHERE league_id = $1',
      [league.id],
    );
    if (Number(memberCount?.count || 0) >= MAX_PREDICTION_LEAGUE_MEMBERS) {
      return { joined: false, reason: 'league_full', league: null };
    }

    await client.run(
      `INSERT INTO ewc_prediction_league_members (league_id, user_id, joined_at)
       VALUES ($1, $2, $3)`,
      [league.id, userId, nowText()],
    );
    return {
      joined: true,
      reason: null,
      league: await scopedLeague(client, { guildId, season, userId, leagueId: league.id }),
    };
  });
}

export async function leavePredictionLeague({ guildId, season, userId, leagueId }) {
  return transaction(async (client) => {
    const league = await scopedLeague(client, { guildId, season, userId, leagueId });
    if (!league) return { left: false, reason: 'not_found' };
    if (league.isOwner) return { left: false, reason: 'owner_cannot_leave' };
    const result = await client.run(
      'DELETE FROM ewc_prediction_league_members WHERE league_id = $1 AND user_id = $2',
      [leagueId, userId],
    );
    return { left: Boolean(changes(result)), reason: null };
  });
}

export async function archivePredictionLeague({ guildId, season, ownerUserId, leagueId }) {
  const result = await run(
    `UPDATE ewc_prediction_leagues
     SET archived_at = $1
     WHERE id = $2 AND guild_id = $3 AND season = $4 AND owner_user_id = $5 AND archived_at IS NULL`,
    [nowText(), leagueId, guildId, season, ownerUserId],
  );
  return Boolean(changes(result));
}

export async function predictionLeagueLeaderboard({ guildId, season, leagueId }) {
  const memberRows = await all(
    `SELECT m.user_id
     FROM ewc_prediction_league_members m
     JOIN ewc_prediction_leagues l ON l.id = m.league_id
     WHERE l.id = $1 AND l.guild_id = $2 AND l.season = $3 AND l.archived_at IS NULL
     ORDER BY m.joined_at ASC, m.user_id ASC
     LIMIT $4`,
    [leagueId, guildId, season, MAX_PREDICTION_LEAGUE_MEMBERS],
  );
  const memberIds = memberRows.map((row) => row.user_id);
  if (!memberIds.length) return [];

  const [officialRows, eligibleRows] = await Promise.all([
    overallLeaderboardForUsers(guildId, season, memberIds),
    all(
      `SELECT DISTINCT wp.user_id
       FROM ewc_weekly_predictions wp
       JOIN ewc_prediction_weeks w ON w.id = wp.week_id
       WHERE wp.guild_id = $1
         AND w.guild_id = $1
         AND w.season = $2
         AND w.status = 'scored'
         AND LENGTH(TRIM(COALESCE(wp.picks_json, ''))) > 2
         AND wp.user_id IN (${memberIds.map((_id, index) => `$${index + 3}`).join(', ')})`,
      [guildId, season, ...memberIds],
    ),
  ]);
  const officialScores = new Map(officialRows.map((row) => [row.user_id, Number(row.score)]));
  const eligible = new Set(eligibleRows.map((row) => row.user_id));
  const entries = memberIds
    .filter((userId) => officialScores.has(userId) || eligible.has(userId))
    .map((userId) => ({ userId, score: officialScores.get(userId) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));

  let previousScore = null;
  let rank = 0;
  return entries.map((entry, index) => {
    if (entry.score !== previousScore) rank = index + 1;
    previousScore = entry.score;
    return { ...entry, rank };
  });
}
