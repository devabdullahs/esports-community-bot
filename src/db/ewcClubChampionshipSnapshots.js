import { all, get, transaction } from './client.js';

const VALID_ELIGIBILITY = new Set(['champion', 'prize']);
export const EWC_CLUB_CHAMPIONSHIP_HISTORY_MAX_SNAPSHOTS = 180;
export const EWC_CLUB_CHAMPIONSHIP_HISTORY_DEFAULT_LIMIT = 60;

function cleanSeason(value) {
  const season = String(value ?? '').trim();
  if (!/^\d{4}$/.test(season)) throw new TypeError('Club Championship season must be a four-digit year.');
  return season;
}

function cleanSourceUrl(value) {
  const sourceUrl = String(value ?? '').trim();
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new TypeError('Club Championship sourceUrl must be an absolute HTTP(S) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('Club Championship sourceUrl must be an absolute HTTP(S) URL.');
  }
  return parsed.toString();
}

function cleanTimestamp(value, field) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new TypeError(`Club Championship ${field} must be a valid timestamp.`);
  return date.toISOString();
}

function nullableNumber(value, field, { integer = false, positive = false } = {}) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || (positive && number < 1)) {
    throw new TypeError(`Club Championship standing ${field} is invalid.`);
  }
  return number;
}

function cleanStandings(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Club Championship standings must contain at least one row.');
  }
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('Club Championship standings rows must be objects.');
    }
    const team = String(row.team ?? '').replace(/\s+/g, ' ').trim();
    if (!team) throw new TypeError('Club Championship standings rows must include a team.');
    const eligibility = row.eligibility == null || row.eligibility === ''
      ? null
      : String(row.eligibility).trim().toLowerCase();
    if (eligibility && !VALID_ELIGIBILITY.has(eligibility)) {
      throw new TypeError('Club Championship standing eligibility is invalid.');
    }
    const wins = nullableNumber(row.wins, 'wins', { integer: true });
    const topEightFinishes = nullableNumber(row.topEightFinishes, 'topEightFinishes', { integer: true });
    if ((wins != null && wins < 0) || (topEightFinishes != null && topEightFinishes < 0)) {
      throw new TypeError('Club Championship standing metrics cannot be negative.');
    }
    return {
      rank: nullableNumber(row.rank, 'rank', { integer: true, positive: true }),
      team,
      points: nullableNumber(row.points, 'points'),
      eligibility,
      wins,
      topEightFinishes,
    };
  });
}

function cleanPrizepool(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('Club Championship prizepool must be an array.');
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new TypeError('Club Championship prizepool must be JSON serializable.');
  }
}

function cleanClubs(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('EWC clubs directory must contain at least one club.');
  }
  const clubs = value.map((club) => {
    if (!club || typeof club !== 'object' || Array.isArray(club)) {
      throw new TypeError('EWC clubs directory rows must be objects.');
    }
    const name = String(club.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new TypeError('EWC clubs directory rows must include a name.');
    const qualifiedCount = nullableNumber(club.qualifiedCount, 'qualifiedCount', { integer: true });
    if (qualifiedCount == null || qualifiedCount < 0) {
      throw new TypeError('EWC clubs directory qualifiedCount is invalid.');
    }
    return { ...club, name, qualifiedCount };
  });
  try {
    return JSON.parse(JSON.stringify(clubs));
  } catch {
    throw new TypeError('EWC clubs directory must be JSON serializable.');
  }
}

function parseJsonArray(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toSnapshot(row) {
  if (!row) return null;
  const standings = parseJsonArray(row.standings_json);
  const prizepool = parseJsonArray(row.prizepool_json);
  const clubs = parseJsonArray(row.clubs_json) ?? [];
  if (!standings?.length || !prizepool) return null;
  return {
    season: row.season,
    sourceUrl: row.source_url,
    standings,
    prizepool,
    clubsSourceUrl: row.clubs_source_url || null,
    clubs,
    clubsFetchedAt: row.clubs_fetched_at || null,
    fetchedAt: row.fetched_at,
    updatedAt: row.updated_at,
  };
}

function toHistorySnapshot(row) {
  if (!row) return null;
  const standings = parseJsonArray(row.standings_json);
  if (!standings?.length) return null;
  return {
    season: row.season,
    standings,
    fetchedAt: row.fetched_at,
  };
}

function cleanHistoryLimit(value) {
  const limit = Number(value ?? EWC_CLUB_CHAMPIONSHIP_HISTORY_DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('Club Championship history limit must be a positive integer.');
  }
  return Math.min(limit, EWC_CLUB_CHAMPIONSHIP_HISTORY_MAX_SNAPSHOTS);
}

function cleanHistorySince(value) {
  if (value == null || value === '') return null;
  return cleanTimestamp(value, 'history since');
}

export function validateEwcClubChampionshipSnapshot(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Club Championship snapshot input is required.');
  }
  const clubs = cleanClubs(input.clubs);
  const clubsSourceUrl = clubs ? cleanSourceUrl(input.clubsSourceUrl) : null;
  const clubsFetchedAt = clubs ? cleanTimestamp(input.clubsFetchedAt, 'clubsFetchedAt') : null;
  return {
    season: cleanSeason(input.season),
    sourceUrl: cleanSourceUrl(input.sourceUrl),
    standings: cleanStandings(input.standings),
    prizepool: cleanPrizepool(input.prizepool),
    clubsSourceUrl,
    clubs,
    clubsFetchedAt,
    fetchedAt: cleanTimestamp(input.fetchedAt, 'fetchedAt'),
  };
}

export async function upsertEwcClubChampionshipSnapshot(input) {
  const snapshot = validateEwcClubChampionshipSnapshot(input);
  const standingsJson = JSON.stringify(snapshot.standings);
  const prizepoolJson = JSON.stringify(snapshot.prizepool);
  const clubsJson = snapshot.clubs ? JSON.stringify(snapshot.clubs) : null;
  const updatedAt = new Date().toISOString();
  await transaction(async (tx) => {
    await tx.run(
      `INSERT INTO ewc_club_championship_snapshots
         (season, source_url, standings_json, prizepool_json, clubs_source_url, clubs_json,
          clubs_fetched_at, fetched_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (season) DO UPDATE SET
         source_url = excluded.source_url,
         standings_json = excluded.standings_json,
         prizepool_json = excluded.prizepool_json,
         clubs_source_url = COALESCE(excluded.clubs_source_url, ewc_club_championship_snapshots.clubs_source_url),
         clubs_json = COALESCE(excluded.clubs_json, ewc_club_championship_snapshots.clubs_json),
         clubs_fetched_at = COALESCE(excluded.clubs_fetched_at, ewc_club_championship_snapshots.clubs_fetched_at),
         fetched_at = excluded.fetched_at,
         updated_at = excluded.updated_at`,
      [
        snapshot.season,
        snapshot.sourceUrl,
        standingsJson,
        prizepoolJson,
        snapshot.clubsSourceUrl,
        clubsJson,
        snapshot.clubsFetchedAt,
        snapshot.fetchedAt,
        updatedAt,
      ],
    );
    await tx.run(
      `INSERT INTO ewc_club_championship_snapshot_history (season, fetched_at, standings_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (season, fetched_at) DO UPDATE SET standings_json = excluded.standings_json`,
      [snapshot.season, snapshot.fetchedAt, standingsJson],
    );
    await tx.run(
      `DELETE FROM ewc_club_championship_snapshot_history
        WHERE season = $1
          AND fetched_at NOT IN (
            SELECT fetched_at
              FROM ewc_club_championship_snapshot_history
             WHERE season = $1
             ORDER BY fetched_at DESC
             LIMIT $2
          )`,
      [snapshot.season, EWC_CLUB_CHAMPIONSHIP_HISTORY_MAX_SNAPSHOTS],
    );
  });
  return getEwcClubChampionshipSnapshot(snapshot.season);
}

export const saveEwcClubChampionshipSnapshot = upsertEwcClubChampionshipSnapshot;

export async function getEwcClubChampionshipSnapshot(season) {
  const row = await get(
    `SELECT season, source_url, standings_json, prizepool_json, clubs_source_url, clubs_json,
            clubs_fetched_at, fetched_at, updated_at
       FROM ewc_club_championship_snapshots
      WHERE season = $1`,
    [cleanSeason(season)],
  );
  return toSnapshot(row);
}

export async function getLatestEwcClubChampionshipSnapshot() {
  const row = await get(
    `SELECT season, source_url, standings_json, prizepool_json, clubs_source_url, clubs_json,
            clubs_fetched_at, fetched_at, updated_at
       FROM ewc_club_championship_snapshots
      ORDER BY fetched_at DESC, updated_at DESC, season DESC
      LIMIT 1`,
    [],
  );
  return toSnapshot(row);
}

/**
 * @param {string} season
 * @param {{ since?: string | Date | null, limit?: number }} [options]
 */
export async function listEwcClubChampionshipSnapshotHistory(
  season,
  { since = null, limit = EWC_CLUB_CHAMPIONSHIP_HISTORY_DEFAULT_LIMIT } = {},
) {
  const rows = await all(
    `SELECT season, standings_json, fetched_at
       FROM ewc_club_championship_snapshot_history
      WHERE season = $1
        AND ($2 IS NULL OR fetched_at >= $2)
      ORDER BY fetched_at DESC
      LIMIT $3`,
    [cleanSeason(season), cleanHistorySince(since), cleanHistoryLimit(limit)],
  );
  return rows.map(toHistorySnapshot).filter(Boolean).reverse();
}
