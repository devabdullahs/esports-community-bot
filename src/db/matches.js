import { all, get, run, transaction } from './client.js';
import { normalizeTeamName } from '../lib/render.js';
import { normalizeGameSlug } from '../lib/games.js';
import {
  mergeMatchLifecycle,
  normalizeMatchLifecycle,
} from '../lib/matchLifecycle.js';
import { EWC_TOURNAMENT_SQL } from './tournamentStandings.js';
import {
  contentHash,
  getFreshMatchAuthority,
  saveOfficialMatchAuthority,
} from './officialEwcSheets.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

const STARTGG_PREVIEW_MATCH_SQL = "(source = 'startgg' AND external_id LIKE 'sgg:preview_%')";
const STARTGG_PREVIEW_MATCH_SQL_M = "(m.source = 'startgg' AND m.external_id LIKE 'sgg:preview_%')";

const OFFICIAL_MATCH_FIELDS = [
  'name',
  'team_a',
  'team_b',
  'score_a',
  'score_b',
  'status',
  'scheduled_at',
  'stream_platform',
  'stream_url',
];

// The result an operator pins by hand. Kept narrow on purpose: a lock freezes the
// outcome, not the match's identity, so team names and stream links keep syncing.
const MANUAL_RESULT_FIELDS = ['score_a', 'score_b', 'status', 'winner_side', 'result_reason'];

// One fixture published twice — by the sheet and by the provider — lands minutes apart
// rather than at the same instant, so the pairing is matched inside a window rather than on
// an exact timestamp. Kept well under the gap between two legitimate same-pair meetings.
const DUPLICATE_FIXTURE_WINDOW_SECONDS = 30 * 60;

export async function upsertMatch(
  row,
  {
    client = null,
    authoritative = false,
    authorityTtlSeconds = 300,
    observedAt = Math.floor(Date.now() / 1000),
    authorityFields = null,
    allowTerminalCorrection = false,
  } = {},
) {
  const merged = {
    name: null,
    team_a: 'TBD',
    team_b: 'TBD',
    logo_a: null,
    logo_b: null,
    score_a: null,
    score_b: null,
    scheduled_at: null,
    stream_platform: null,
    stream_url: null,
    winner_side: null,
    result_reason: 'unknown',
    ...row,
  };
  const now = nowText();
  const persist = async (tx) => {
    const existing = await tx.get(
      'SELECT * FROM matches WHERE source = $1 AND external_id = $2',
      [merged.source, merged.external_id],
    );
    // An operator-pinned result outranks every provider, including the official
    // feed, which would otherwise re-derive and overwrite it on its next poll.
    // Everything else about the row (names, logos, stream, schedule) still syncs.
    if (existing?.result_locked_at) {
      for (const field of MANUAL_RESULT_FIELDS) merged[field] = existing[field];
    }
    if (existing && !authoritative) {
      const protectedFields = await getFreshMatchAuthority(existing.id, {
        client: tx,
        now: observedAt,
      });
      // An official live snapshot is provisional until it reaches a terminal
      // score. Let a fallback provider close that currently-running row when it
      // has a numeric result; the official schedule and any completed official
      // result remain protected by the normal authority lease.
      const allowTerminalFallback =
        existing.status === 'running' &&
        merged.status === 'finished' &&
        merged.score_a != null &&
        merged.score_b != null;
      for (const field of protectedFields || []) {
        if (allowTerminalFallback && ['score_a', 'score_b', 'status'].includes(field)) continue;
        if (OFFICIAL_MATCH_FIELDS.includes(field)) merged[field] = existing[field];
      }
    }
    const normalizedLifecycle = normalizeMatchLifecycle(merged);
    const lifecycle = existing
      ? mergeMatchLifecycle(existing, merged, { allowTerminalCorrection })
      : {
          ...normalizedLifecycle,
          status: normalizedLifecycle.status || 'scheduled',
          status_accepted: true,
        };
    const accepted = !existing || lifecycle.status_accepted;
    // A pinned result is decided before lifecycle merging gets a say, so no provider
    // transition can talk the row back out of it.
    const locked = Boolean(existing?.result_locked_at);
    if (locked) {
      lifecycle.status = existing.status;
      lifecycle.winner_side = existing.winner_side;
      lifecycle.result_reason = existing.result_reason;
    }
    const scoreA = locked
      ? existing.score_a
      : existing && !accepted
        ? existing.score_a
        : merged.score_a ?? existing?.score_a ?? null;
    const scoreB = locked
      ? existing.score_b
      : existing && !accepted
        ? existing.score_b
        : merged.score_b ?? existing?.score_b ?? null;
    // A provider can report the same fixture with its sides flipped. Team names always take
    // the incoming value, so a logo the row omits must be carried by TEAM rather than by
    // slot — otherwise the names swap, the crests stay put, and each team wears the other's.
    // A stored logo whose team is no longer in the row belongs to nobody: drop it rather
    // than leave the wrong crest behind.
    const storedLogoFor = (team) => {
      const target = normalizeTeamName(team);
      if (!existing || !target) return null;
      if (normalizeTeamName(existing.team_a) === target) return existing.logo_a ?? null;
      if (normalizeTeamName(existing.team_b) === target) return existing.logo_b ?? null;
      return null;
    };
    const logoA = merged.logo_a ?? storedLogoFor(merged.team_a);
    const logoB = merged.logo_b ?? storedLogoFor(merged.team_b);

    const scheduledAt = existing && !accepted
      ? existing.scheduled_at
      : merged.scheduled_at ?? existing?.scheduled_at ?? null;
    const streamPlatform = existing && !accepted
      ? existing.stream_platform
      : merged.stream_platform;
    const streamUrl = existing && !accepted ? existing.stream_url : merged.stream_url;

    const persisted = await tx.get(
      `INSERT INTO matches
         (tournament_id, source, external_id, name, team_a, team_b, logo_a, logo_b,
          score_a, score_b, status, winner_side, result_reason, scheduled_at,
          stream_platform, stream_url, last_polled_at, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       ON CONFLICT (source, external_id) DO UPDATE SET
         tournament_id = excluded.tournament_id,
         name          = excluded.name,
         team_a        = excluded.team_a,
         team_b        = excluded.team_b,
         -- Already resolved by team identity above, so take it verbatim: a COALESCE onto
         -- the stored slot is what let a side swap leave the crests behind.
         logo_a        = excluded.logo_a,
         logo_b        = excluded.logo_b,
         score_a       = excluded.score_a,
         score_b       = excluded.score_b,
         status        = excluded.status,
         winner_side   = excluded.winner_side,
         result_reason = excluded.result_reason,
         scheduled_at  = excluded.scheduled_at,
         stream_platform = excluded.stream_platform,
         stream_url      = excluded.stream_url,
         last_polled_at = $17,
         updated_at    = $17
       RETURNING *`,
      [
        merged.tournament_id,
        merged.source,
        merged.external_id,
        merged.name,
        merged.team_a,
        merged.team_b,
        logoA,
        logoB,
        scoreA,
        scoreB,
        lifecycle.status,
        lifecycle.winner_side,
        lifecycle.result_reason,
        scheduledAt,
        streamPlatform,
        streamUrl,
        now,
      ],
    );

    if (existing?.status !== 'cancelled' && persisted.status === 'cancelled') {
      await tx.run(
        `UPDATE user_match_reminders
            SET canceled_at = $1
          WHERE match_id = $2 AND canceled_at IS NULL`,
        [now, persisted.id],
      );
    }
    if (authoritative) {
      const fields = new Set(
        (authorityFields || OFFICIAL_MATCH_FIELDS).filter(
          (field) =>
            OFFICIAL_MATCH_FIELDS.includes(field) &&
            Object.prototype.hasOwnProperty.call(row, field) &&
            row[field] !== null &&
            row[field] !== undefined,
        ),
      );
      await saveOfficialMatchAuthority(tx, {
        matchId: persisted.id,
        observedAt,
        expiresAt: observedAt + authorityTtlSeconds,
        hash: contentHash(Object.fromEntries([...fields].map((field) => [field, persisted[field]]))),
        fields,
      });
    }

    return persisted;
  };
  return client ? persist(client) : transaction(persist);
}

// Map a parser result (camelCase) into a DB row (snake_case).
export function toMatchRow(parsed, tournamentId) {
  const lifecycle = normalizeMatchLifecycle(parsed);
  return {
    tournament_id: tournamentId,
    source: parsed.source,
    external_id: parsed.externalId,
    name: parsed.name ?? `${parsed.teamA} vs ${parsed.teamB}`,
    team_a: parsed.teamA,
    team_b: parsed.teamB,
    logo_a: parsed.logoA ?? null,
    logo_b: parsed.logoB ?? null,
    score_a: parsed.scoreA ?? null,
    score_b: parsed.scoreB ?? null,
    status: lifecycle.status,
    winner_side: lifecycle.winner_side,
    result_reason: lifecycle.result_reason,
    scheduled_at: parsed.scheduledAt ?? null,
    stream_platform: parsed.stream?.platform ?? null,
    stream_url: parsed.stream?.url ?? null,
  };
}

export async function getMatch(source, externalId) {
  return get('SELECT * FROM matches WHERE source = $1 AND external_id = $2', [source, externalId]);
}

export async function listMatchesForTournament(tournamentId) {
  return all(
    `SELECT *
       FROM matches
      WHERE tournament_id = $1
        AND NOT (source = 'startgg' AND external_id LIKE 'sgg:preview_%')
      ORDER BY scheduled_at ASC, id ASC`,
    [tournamentId],
  );
}

// Current Liquipedia Swiss grids expose completed round scores but no timestamps.
// Reuse an already-persisted scheduled identity only when the pairing has one
// unambiguous stored occurrence. Ambiguous same-pair rematches keep their parser
// identity so a score can never be applied to the wrong match.
export async function reconcileUntimedTournamentMatches(tournamentId, parsedMatches) {
  if (!Array.isArray(parsedMatches) || !parsedMatches.length) return parsedMatches || [];
  const untimed = parsedMatches.filter(
    (match) => match?.scheduledAt == null && Number.isInteger(match?.roundIndex),
  );
  if (!untimed.length) return parsedMatches;

  const existing = await all(
    `SELECT id, source, external_id, team_a, team_b, logo_a, logo_b, scheduled_at
       FROM matches
      WHERE tournament_id = $1 AND scheduled_at IS NOT NULL
      ORDER BY scheduled_at ASC, id ASC`,
    [tournamentId],
  );
  const pairKey = (teamA, teamB) =>
    [normalizeTeamName(teamA), normalizeTeamName(teamB)].sort().join('|');
  const storedByPair = new Map();
  for (const row of existing) {
    const key = `${row.source}|${pairKey(row.team_a, row.team_b)}`;
    const bucket = storedByPair.get(key);
    if (bucket) bucket.push(row);
    else storedByPair.set(key, [row]);
  }

  const parsedByPair = new Map();
  for (const match of untimed) {
    const key = `${match.source}|${pairKey(match.teamA, match.teamB)}`;
    const bucket = parsedByPair.get(key);
    if (bucket) bucket.push(match);
    else parsedByPair.set(key, [match]);
  }

  const replacements = new Map();
  for (const [key, matches] of parsedByPair) {
    const stored = storedByPair.get(key) || [];
    if (stored.length !== matches.length) continue;
    const orderedMatches = [...matches].sort((a, b) => a.roundIndex - b.roundIndex);
    for (let index = 0; index < orderedMatches.length; index++) {
      const match = orderedMatches[index];
      const row = stored[index];
      replacements.set(match, {
        ...match,
        externalId: row.external_id,
        scheduledAt: Number(row.scheduled_at),
        logoA: match.logoA || (normalizeTeamName(match.teamA) === normalizeTeamName(row.team_a) ? row.logo_a : row.logo_b),
        logoB: match.logoB || (normalizeTeamName(match.teamB) === normalizeTeamName(row.team_b) ? row.logo_b : row.logo_a),
      });
    }
  }

  return parsedMatches.map((match) => replacements.get(match) || match);
}

const MATCH_ALIAS_WINDOW_SECONDS = 15 * 60;

function normalizedPair(m) {
  return [normalizeTeamName(m.team_a), normalizeTeamName(m.team_b)].sort().join('|');
}

function scheduledTimestamp(m) {
  const value = Number(m.scheduled_at);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

// Stable identity for persisted event state. Tournament names and page paths are excluded:
// a parent page and its stage page can expose the same match under different external ids.
// Unknown-time rows keep their external id so unscheduled rematches never collide.
export function matchEventKey(m) {
  const game = normalizeGameSlug(String(m.game ?? ''));
  const timestamp = scheduledTimestamp(m);
  const occurrence = timestamp == null ? `external:${String(m.external_id ?? '')}` : `at:${timestamp}`;
  return `${game}|${normalizedPair(m)}|${occurrence}`;
}

function tournamentSpecificity(m) {
  const path = String(m.tournament_path ?? m.tournament_external_id ?? '');
  const pathDepth = path.split('/').filter(Boolean).length;
  const stageName = /(?:group|play-?offs?|finals?|survivor|stage|bracket)/i.test(String(m.tournament_name ?? ''));
  return pathDepth * 10 + (stageName ? 1 : 0);
}

function matchRank(m) {
  const hasScore = m.score_a != null && m.score_b != null;
  const hasWinner = m.winner_side != null;
  const status =
    m.status === 'finished' && (hasScore || hasWinner)
      ? 300
      : m.status === 'running'
        ? 200
        : m.status === 'finished'
          ? 150
          : m.status === 'cancelled'
            ? 125
            : m.status === 'postponed'
              ? 100
              : 0;
  const stableMatchId = /^Match:/i.test(m.external_id || '') ? 40 : 0;
  const structural = /:(?:matchlist|bracket):/i.test(m.external_id || '') ? 10 : 0;
  const liveWidgetFallback = /^[^:]+:\d+:/i.test(m.external_id || '') ? -10 : 0;
  return (
    status +
    stableMatchId +
    structural +
    liveWidgetFallback +
    (hasScore ? 20 : 0) +
    (m.logo_a ? 1 : 0) +
    (m.logo_b ? 1 : 0)
  );
}

function compareMatchCopies(a, b) {
  const quality = matchRank(a) - matchRank(b);
  if (quality) return quality;
  const specificity = tournamentSpecificity(a) - tournamentSpecificity(b);
  if (specificity) return specificity;
  const external = String(b.external_id ?? '').localeCompare(String(a.external_id ?? ''));
  if (external) return external;
  return Number(b.id ?? 0) - Number(a.id ?? 0);
}

// Collapse copies from widgets, brackets, parent pages, and stage pages. Timestamped copies
// merge only inside a narrow window, preserving legitimate same-pair rematches later that day.
export function dedupeMatches(rows) {
  const groups = [];
  for (const [index, row] of rows.entries()) {
    const baseKey = `${normalizeGameSlug(String(row.game ?? ''))}|${normalizedPair(row)}`;
    const timestamp = scheduledTimestamp(row);
    const group = groups.find(
      (candidate) =>
        candidate.baseKey === baseKey &&
        ((timestamp != null &&
          candidate.timestamp != null &&
          Math.abs(timestamp - candidate.timestamp) <= MATCH_ALIAS_WINDOW_SECONDS) ||
          (timestamp == null && candidate.timestamp == null && candidate.externalId === String(row.external_id ?? ''))),
    );
    if (!group) {
      groups.push({
        baseKey,
        timestamp,
        externalId: String(row.external_id ?? ''),
        firstIndex: index,
        best: row,
      });
    } else if (compareMatchCopies(row, group.best) > 0) {
      group.best = row;
    }
  }
  const exact = groups.sort((a, b) => a.firstIndex - b.firstIndex).map((group) => group.best);

  const byTime = new Map();
  for (const row of exact) {
    if (!row.scheduled_at) continue;
    const key = `${normalizeGameSlug(String(row.game ?? ''))}|${row.scheduled_at}`;
    const group = byTime.get(key);
    if (group) group.push(row);
    else byTime.set(key, [row]);
  }

  const drop = new Set();
  const teamKeys = (m) => [normalizeTeamName(m.team_a), normalizeTeamName(m.team_b)].filter(Boolean);
  for (const group of byTime.values()) {
    if (group.length < 2) continue;
    const chosen = [];
    for (const row of [...group].sort((a, b) => compareMatchCopies(b, a))) {
      const keys = new Set(teamKeys(row));
      const duplicate = chosen.some((kept) => teamKeys(kept).some((key) => keys.has(key)));
      if (duplicate) drop.add(row);
      else chosen.push(row);
    }
  }

  return exact.filter((r) => !drop.has(r));
}

// All matches for a guild's active tournaments, with the tournament's game/name attached.
// Ordered: live first, then upcoming/postponed, then terminal outcomes.
export async function getMatchesForGuild(guildId) {
  const rows = await all(
    `SELECT m.*, t.game AS game, t.name AS tournament_name,
            t.url AS tournament_url, t.external_id AS tournament_path, t.source AS tournament_source,
            CASE WHEN EXISTS (
              SELECT 1
                FROM official_match_authority oma
               WHERE oma.match_id = m.id
            ) THEN 1 ELSE 0 END AS official_authoritative
     FROM matches m
     JOIN tournaments t ON t.id = m.tournament_id
     WHERE t.guild_id = $1 AND t.active = 1
       AND t.archived_at IS NULL
       AND NOT ${STARTGG_PREVIEW_MATCH_SQL_M}
     ORDER BY CASE m.status
                WHEN 'running' THEN 0
                WHEN 'scheduled' THEN 1
                WHEN 'postponed' THEN 2
                WHEN 'finished' THEN 3
                ELSE 4
              END,
              m.scheduled_at ASC`,
    [guildId],
  );
  return dedupeMatches(rows);
}

// Matches that still need watching: pending, running, or awaiting a reschedule.
export async function getActiveMatches() {
  const cutoff = Math.floor(Date.now() / 1000) - 43200;
  return all(
    `SELECT m.*
     FROM matches m
     JOIN tournaments t ON t.id = m.tournament_id
     WHERE t.active = 1
       AND t.archived_at IS NULL
       AND m.status IN ('scheduled','running','postponed')
       AND (
         m.status = 'postponed'
         OR m.scheduled_at IS NULL
         OR m.scheduled_at > $1
       )
       AND NOT ${STARTGG_PREVIEW_MATCH_SQL_M}`,
    [cutoff],
  );
}

// Distinct crest URLs across active, non-archived tournaments' matches. The logo
// warmup job pre-downloads these into the shared on-disk cache so the web logo
// proxy (which never fetches upstream on public page views) can serve them.
export async function listTrackedMatchLogos() {
  const now = Math.floor(Date.now() / 1000);
  const recentCutoff = now - 7 * 24 * 60 * 60;
  const rows = await all(
    `SELECT logo
       FROM (
         SELECT logo, MIN(priority) AS priority, MIN(sort_at) AS sort_at
           FROM (
             SELECT m.logo_a AS logo,
                    CASE
                      WHEN m.status = 'running' THEN 0
                      WHEN m.status = 'scheduled' AND (m.scheduled_at IS NULL OR m.scheduled_at >= $1) THEN 1
                      WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at >= $2 THEN 2
                      ELSE 3
                    END AS priority,
                    COALESCE(m.scheduled_at, 2147483647) AS sort_at
               FROM matches m
               JOIN tournaments t ON t.id = m.tournament_id
              WHERE t.active = 1 AND t.archived_at IS NULL AND m.logo_a IS NOT NULL AND m.logo_a <> ''
             UNION ALL
             SELECT m.logo_b AS logo,
                    CASE
                      WHEN m.status = 'running' THEN 0
                      WHEN m.status = 'scheduled' AND (m.scheduled_at IS NULL OR m.scheduled_at >= $1) THEN 1
                      WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at >= $2 THEN 2
                      ELSE 3
                    END AS priority,
                    COALESCE(m.scheduled_at, 2147483647) AS sort_at
               FROM matches m
               JOIN tournaments t ON t.id = m.tournament_id
              WHERE t.active = 1 AND t.archived_at IS NULL AND m.logo_b IS NOT NULL AND m.logo_b <> ''
           ) AS logo_rows
          GROUP BY logo
       ) AS crests
      ORDER BY priority ASC, sort_at ASC, logo ASC`,
    [now, recentCutoff],
  );
  return rows.map((row) => row.logo).filter(Boolean);
}

export async function markFinished(id) {
  return run(
    `UPDATE matches
        SET status = 'finished',
            winner_side = CASE
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a > score_b THEN 'team1'
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_b > score_a THEN 'team2'
              ELSE winner_side
            END,
            result_reason = CASE
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a <> score_b THEN 'normal'
              ELSE result_reason
            END,
            updated_at = $1
      WHERE id = $2 AND status NOT IN ('finished','cancelled')`,
    [nowText(), id],
  );
}

export async function markFinishedByExternalId(source, externalId) {
  return run(
    `UPDATE matches
        SET status = 'finished',
            winner_side = CASE
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a > score_b THEN 'team1'
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_b > score_a THEN 'team2'
              ELSE winner_side
            END,
            result_reason = CASE
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a <> score_b THEN 'normal'
              ELSE result_reason
            END,
            updated_at = $1
      WHERE source = $2 AND external_id = $3 AND status NOT IN ('finished','cancelled')`,
    [nowText(), source, externalId],
  );
}

// If a source leaves an already-started match without a posted result, it can stay
// scheduled/running forever. Flip those stale active rows to finished so boards stop
// showing old matches as live or upcoming while the parser catches up.
export async function markStaleActiveFinished(staleSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - staleSeconds;
  const result = await run(
    `UPDATE matches
        SET status = 'finished',
            winner_side = CASE
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a > score_b THEN 'team1'
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_b > score_a THEN 'team2'
              ELSE NULL
            END,
            result_reason = CASE
              WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a <> score_b THEN 'normal'
              ELSE 'unknown'
            END,
            updated_at = $1
     WHERE status IN ('scheduled','running') AND scheduled_at IS NOT NULL AND scheduled_at < $2`,
    [nowText(), cutoff],
  );
  return result.changes || 0;
}

// Reschedule churn (an externalId once keyed on a shifting start time) can leave a
// finished match with no score — a phantom shadowing the real, correctly-scored row
// for the SAME pair in the SAME tournament. Retire those phantoms so they don't
// pollute results/counts. Only deletes a finished null-score row when a finished
// SCORED row exists for the same normalized team pair in the same tournament, so a
// genuinely-unresolved match (no scored twin) is always kept.
export async function deleteResolvedDuplicateMatches() {
  const now = Math.floor(Date.now() / 1000);
  const rows = await all(
    `SELECT m.id, m.tournament_id, m.team_a, m.team_b, m.score_a, m.score_b,
            CASE WHEN EXISTS (
              SELECT 1 FROM official_match_authority oma
               WHERE oma.match_id = m.id AND oma.expires_at > $1
            ) THEN 1 ELSE 0 END AS official_fresh
       FROM matches m
      WHERE m.status = 'finished'`,
    [now],
  );
  const pairKey = (r) =>
    `${r.tournament_id}|${[normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|')}`;
  const scoredPairs = new Set();
  for (const r of rows) {
    if (r.score_a != null && r.score_b != null) scoredPairs.add(pairKey(r));
  }
  const ids = rows
    .filter(
      (r) =>
        !r.official_fresh &&
        (r.score_a == null || r.score_b == null) &&
        scoredPairs.has(pairKey(r)),
    )
    .map((r) => r.id);
  if (!ids.length) return 0;
  await transaction(async (tx) => {
    for (const id of ids) await tx.run('DELETE FROM matches WHERE id = $1', [id]);
  });
  return ids.length;
}

// A bracket slot that was never drawn keeps a name that refers to another match
// instead of a team: "Winner of 2.1", "UBSF M1 Loser", "TBD". A real team name never
// does. This is what separates an abandoned placeholder from a legitimately scoreless
// finished row, which a scoreless-finished filter alone cannot tell apart.
export function isUnresolvedPlaceholderName(name) {
  const value = String(name ?? '').trim();
  if (!value) return true;
  return /^tbd$/i.test(value) ||
    /\b(?:winner|loser)\s+of\b/i.test(value) ||
    /\b(?:winner|loser)$/i.test(value) ||
    // A bracket also refers to a slot by where it finishes rather than by another match:
    // "Group A #1", "Group B #2", "Seed #9", "Seed #8/#9". A real team never names itself
    // that way, and the provider republishes these as the draw resolves, so the earlier
    // generations pile up beside the drawn fixture.
    /^group\s+\S+\s*#\s*\d+$/i.test(value) ||
    /^seed\s*#?\s*\d+(?:\s*\/\s*#?\d+)*$/i.test(value);
}

// A provider can leave a scoreless finished bracket placeholder behind after
// its source match is replaced. Keep recent unresolved rows for reconciliation,
// but retire old Liquipedia rows so they do not remain in tournament history.
//
// Scorelessness alone is NOT enough to call a row abandoned: battle-royale and lobby
// games (Warzone, Apex, PUBG, Fortnite) rank by placement and legitimately finish with
// no score, as do head-to-head rows whose score was never published. Requiring an
// unresolved placeholder name keeps those in tournament history.
export async function deleteStaleFinishedMatches(
  tournamentId,
  {
    staleAfterSeconds = 4 * 3600,
    nowSeconds = Math.floor(Date.now() / 1000),
    client = null,
  } = {},
) {
  const reader = client || { all };
  const cutoff = Number(nowSeconds) - Math.max(0, Number(staleAfterSeconds) || 0);
  const candidates = await reader.all(
    `SELECT m.id, m.team_a, m.team_b
       FROM matches m
      WHERE m.tournament_id = $1
        AND m.source = 'liquipedia'
        -- A slot that was never drawn can sit at 'scheduled' forever once its real
        -- match has been played under the drawn names, so sweep those too. Both
        -- states still require the placeholder name check below.
        AND m.status IN ('finished', 'scheduled')
        AND m.score_a IS NULL
        AND m.score_b IS NULL
        AND m.scheduled_at IS NOT NULL
        AND m.scheduled_at < $2
        AND NOT EXISTS (
          SELECT 1
            FROM official_match_authority oma
           WHERE oma.match_id = m.id
             AND oma.expires_at > $3
        )`,
    [tournamentId, cutoff, nowSeconds],
  );
  const rows = candidates.filter(
    (row) => isUnresolvedPlaceholderName(row.team_a) || isUnresolvedPlaceholderName(row.team_b),
  );
  if (!rows.length) return 0;

  const remove = async (tx) => {
    for (const row of rows) await tx.run('DELETE FROM matches WHERE id = $1', [row.id]);
  };
  if (client) await remove(client);
  else await transaction(remove);
  return rows.length;
}

// Live widgets can use redirected short names before the stable match row resolves
// (for example PTime -> PlayTime). Once a single stable, scored row exists for
// the same normalized pair/day, retire older timestamp-keyed alias rows immediately
// so they do not stay live while waiting for the next Liquipedia fetch.
export async function deleteResolvedLiveAliasMatches() {
  const now = Math.floor(Date.now() / 1000);
  const rows = await all(
    `SELECT m.id, m.tournament_id, m.source, m.external_id, m.team_a, m.team_b,
            m.score_a, m.score_b, m.status, m.scheduled_at,
            CASE WHEN EXISTS (
              SELECT 1 FROM official_match_authority oma
               WHERE oma.match_id = m.id AND oma.expires_at > $1
            ) THEN 1 ELSE 0 END AS official_fresh
       FROM matches m
      WHERE m.source = 'liquipedia'
       AND m.scheduled_at IS NOT NULL
       AND (
         (m.status IN ('running','finished') AND m.score_a IS NOT NULL AND m.score_b IS NOT NULL)
         OR m.status IN ('scheduled','running')
       )`,
    [now],
  );
  const liveWidgetFallback = (r) => /^[^:]+:\d+:/i.test(String(r.external_id ?? ''));
  const normalizedDayKeyOf = (r) => {
    const pair = [normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|');
    return `${r.tournament_id}|${pair}|${Math.floor(Number(r.scheduled_at) / 86400)}`;
  };
  const rawPairKeyOf = (r) =>
    [r.team_a, r.team_b]
      .map((value) =>
        String(value ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase(),
      )
      .sort()
      .join('|');

  const canonicalByDay = new Map();
  for (const r of rows) {
    if (
      liveWidgetFallback(r) ||
      !['running', 'finished'].includes(r.status) ||
      r.score_a == null ||
      r.score_b == null
    )
      continue;
    const key = normalizedDayKeyOf(r);
    const bucket = canonicalByDay.get(key);
    if (bucket) bucket.push(r);
    else canonicalByDay.set(key, [r]);
  }

  const ids = [];
  for (const r of rows) {
    if (r.official_fresh || !liveWidgetFallback(r) || !['scheduled', 'running'].includes(r.status)) {
      continue;
    }
    const candidates = canonicalByDay.get(normalizedDayKeyOf(r)) || [];
    if (candidates.length !== 1) continue;
    const canonical = candidates[0];
    if (rawPairKeyOf(r) === rawPairKeyOf(canonical)) continue;
    if (Number(r.scheduled_at) <= Number(canonical.scheduled_at)) ids.push(r.id);
  }
  if (!ids.length) return 0;
  await transaction(async (tx) => {
    for (const id of ids) await tx.run('DELETE FROM matches WHERE id = $1', [id]);
  });
  return ids.length;
}

export async function deleteTournamentPlaceholderMatches(
  tournamentId,
  currentExternalIds = null,
  { client = null } = {},
) {
  const reader = client || { all };
  const now = Math.floor(Date.now() / 1000);
  const rows = await reader.all(
    `SELECT m.id, m.external_id, m.team_a, m.team_b, m.scheduled_at,
            m.status, m.score_a, m.score_b,
            CASE WHEN EXISTS (
              SELECT 1 FROM official_match_authority oma
               WHERE oma.match_id = m.id AND oma.expires_at > $2
            ) THEN 1 ELSE 0 END AS official_fresh
       FROM matches m
      WHERE m.tournament_id = $1`,
    [tournamentId, now],
  );
  const current = currentExternalIds ? new Set(currentExternalIds) : null;
  const staleAfterSeconds = 4 * 3600;
  const clean = (value) =>
    String(value ?? '')
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const isPlaceholder = (value) => {
    const text = clean(value);
    return !text || /^TBD$/i.test(text);
  };

  // A provider can publish the same fixture as an untimed row alongside the timed one it
  // actually played under, and the duplicate sweep deliberately leaves untimed rows alone
  // because it cannot tell which of two same-pair rematches they belong to. Nothing revisits
  // them once the event ends, so they linger on cards forever as "Time TBD".
  //
  // After the tournament concludes that ambiguity no longer matters: a row with no time, no
  // score and no terminal status will never resolve into anything. Concluded means it has
  // played at least one match AND has nothing left on the clock — an unstarted bracket has
  // no finished match, so its undrawn rows are never touched by this.
  const concluded =
    rows.some((row) => String(row.status ?? '') === 'finished') &&
    !rows.some((row) => Number(row.scheduled_at) > now - staleAfterSeconds);
  const abandonedAfterConclusion = (row) =>
    concluded &&
    row.scheduled_at == null &&
    String(row.status ?? '') !== 'finished' &&
    row.score_a == null &&
    row.score_b == null;

  // An undrawn slot ("Winner of UB 1.1") and the match it became are the same fixture at
  // the same minute, so once a round is drawn its undrawn copies are duplicates on every
  // upcoming list. deleteStaleFinishedMatches only retires those four hours after start;
  // a drawn sibling in the same slot is positive evidence now.
  //
  // Compare COUNTS, not names — the drawn rows cannot be paired back to the slots they
  // came from. A round drawn only in part keeps its remaining placeholders, because its
  // drawn rows do not yet cover them.
  const undrawn = (row) =>
    isUnresolvedPlaceholderName(row.team_a) || isUnresolvedPlaceholderName(row.team_b);
  const slots = new Map();
  for (const row of rows) {
    const at = Number(row.scheduled_at);
    if (!Number.isFinite(at) || at <= 0) continue;
    const slot = slots.get(at) || { drawn: 0, undrawn: 0 };
    slot[undrawn(row) ? 'undrawn' : 'drawn'] += 1;
    slots.set(at, slot);
  }
  const supersededByDraw = (row) => {
    if (!undrawn(row) || row.score_a != null || row.score_b != null) return false;
    const slot = slots.get(Number(row.scheduled_at));
    return Boolean(slot) && slot.drawn >= slot.undrawn;
  };

  // The official sheet publishes a fixture before the provider does, so the feed creates a
  // row of its own. Once the provider publishes the same pair, the feed writes to THAT row
  // instead and its earlier copy is left behind — one fixture showing twice, minutes apart,
  // under slightly different spellings of the same names.
  //
  // The copy is always the `official:` one, and retiring it loses nothing: the sheet's
  // values keep winning on the surviving row through their authority lease. It also
  // un-splits the pair, which a same-pair lookup needs to resolve at all.
  const isOfficialRow = (row) => String(row.external_id ?? '').startsWith('official:');
  const pairKey = (row) => {
    const a = normalizeTeamName(row.team_a);
    const b = normalizeTeamName(row.team_b);
    return a && b ? [a, b].sort().join('|') : '';
  };
  const providerRows = rows.filter((row) => !isOfficialRow(row));
  const supersededByProvider = (row) => {
    if (!isOfficialRow(row)) return false;
    const at = Number(row.scheduled_at);
    if (!Number.isFinite(at)) return false;
    const pair = pairKey(row);
    if (!pair) return false;
    return providerRows.some((other) => {
      const otherAt = Number(other.scheduled_at);
      if (!Number.isFinite(otherAt) || Math.abs(at - otherAt) > DUPLICATE_FIXTURE_WINDOW_SECONDS) return false;
      if (pairKey(other) !== pair) return false;
      // Never trade a recorded result for one that has none.
      const copyHasScore = row.score_a != null || row.score_b != null;
      const keptHasScore = other.score_a != null || other.score_b != null;
      return keptHasScore || !copyHasScore;
    });
  };

  // Liquipedia carries a bracket slot for every position the same two competitors COULD
  // meet in. Once the draw settles, the unused slot stays behind as a finished row with no
  // decisive result — "Yagami vs Mulgold 0:0" sitting beside the real "Mulgold 2:3 Yagami".
  //
  // Requiring the row to be ABSENT from the latest fetch is what makes this safe: a real
  // drawn match is still published and keeps its place, and a game whose matches genuinely
  // finish level is untouched as long as the provider still lists them.
  const decisive = (row) =>
    row.score_a != null && row.score_b != null && Number(row.score_a) !== Number(row.score_b);
  const supersededByResult = (row) => {
    if (!current || current.has(row.external_id)) return false;
    if (String(row.status ?? '') !== 'finished' || decisive(row)) return false;
    const pair = pairKey(row);
    if (!pair) return false;
    return rows.some((other) => other.id !== row.id && pairKey(other) === pair && decisive(other));
  };

  const ids = rows
    .filter((row) => {
      if (row.official_fresh) return false;
      if (abandonedAfterConclusion(row)) return true;
      if (supersededByDraw(row)) return true;
      if (supersededByProvider(row)) return true;
      if (supersededByResult(row)) return true;
      if (/^sgg:preview_/i.test(String(row.external_id ?? ''))) {
        return current && !current.has(row.external_id);
      }
      if (/^.+:br-schedule:/i.test(String(row.external_id ?? ''))) {
        return current && !current.has(row.external_id);
      }
      const placeholderA = isPlaceholder(row.team_a);
      const placeholderB = isPlaceholder(row.team_b);
      if (placeholderA && placeholderB) return true;
      if (!placeholderA && !placeholderB) return false;

      const missingFromLatest = current && !current.has(row.external_id);
      const overdue = row.scheduled_at && row.scheduled_at < now - staleAfterSeconds;
      return missingFromLatest || overdue;
    })
    .map((row) => row.id);
  if (!ids.length) return 0;
  const remove = async (tx) => {
    for (const id of ids) await tx.run('DELETE FROM matches WHERE id = $1', [id]);
  };
  if (client) await remove(client);
  else await transaction(remove);
  return ids.length;
}

// Remove redundant duplicate rows within a tournament. A page can render the SAME
// match in two widgets (e.g. a bracket AND a match list), so it lands under two
// external ids that collapse to one on reads. Once a fetch settles on one canonical
// id for the same pair at the same exact start time, any sibling row in that group
// but absent from the current set is a stale duplicate and safe to drop. A group
// with NO current row is left untouched (it may be a transient parse gap), and
// untimed rows are skipped because same-pair rematches cannot be separated safely.
// Timestamp-keyed live-widget aliases are also retired when a current scored
// row covers the same normalized pair/day at or after that widget
// time, which clears stale redirect aliases like PTime -> PlayTime without
// deleting a later same-day rematch. Current stable rows with live scores count
// too, so old alias rows do not survive until the match fully finishes.
export async function deleteTournamentDuplicateMatches(
  tournamentId,
  currentExternalIds,
  { client = null } = {},
) {
  if (!currentExternalIds || !currentExternalIds.length) return 0;
  const current = new Set(currentExternalIds);
  const reader = client || { all };
  const now = Math.floor(Date.now() / 1000);
  const rows = await reader.all(
    `SELECT m.id, m.external_id, m.team_a, m.team_b, m.score_a, m.score_b, m.status,
            m.scheduled_at,
            CASE WHEN EXISTS (
              SELECT 1 FROM official_match_authority oma
               WHERE oma.match_id = m.id AND oma.expires_at > $2
            ) THEN 1 ELSE 0 END AS official_fresh
       FROM matches m
      WHERE m.tournament_id = $1`,
    [tournamentId, now],
  );
  const liveWidgetFallback = (r) => /^[^:]+:\d+:/i.test(String(r.external_id ?? ''));
  const keyOf = (r) => {
    if (!r.scheduled_at) return null;
    return `${[normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|')}|${r.scheduled_at}`;
  };
  const dayKeyOf = (r) => {
    if (!r.scheduled_at) return null;
    const pair = [normalizeTeamName(r.team_a), normalizeTeamName(r.team_b)].sort().join('|');
    return `${pair}|${Math.floor(Number(r.scheduled_at) / 86400)}`;
  };
  const groups = new Map(); // key -> { hasCurrent, staleIds: [] }
  const currentScoredByDay = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    if (key) {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { hasCurrent: false, staleIds: [] }));
      if (current.has(r.external_id)) g.hasCurrent = true;
      else if (!r.official_fresh) g.staleIds.push(r.id);
    }

    const dayKey = dayKeyOf(r);
    const hasScoredResult =
      ['running', 'finished'].includes(r.status) && r.score_a != null && r.score_b != null;
    if (dayKey && current.has(r.external_id) && hasScoredResult) {
      const bucket = currentScoredByDay.get(dayKey);
      if (bucket) bucket.push(r);
      else currentScoredByDay.set(dayKey, [r]);
    }
  }
  const ids = new Set();
  for (const g of groups.values()) if (g.hasCurrent) for (const id of g.staleIds) ids.add(id);
  for (const r of rows) {
    if (r.official_fresh || current.has(r.external_id) || !liveWidgetFallback(r)) continue;
    const candidates = currentScoredByDay.get(dayKeyOf(r)) || [];
    if (candidates.length !== 1) continue;
    if (Number(r.scheduled_at) <= Number(candidates[0].scheduled_at)) ids.add(r.id);
  }
  if (!ids.size) return 0;
  const remove = async (tx) => {
    for (const id of ids) await tx.run('DELETE FROM matches WHERE id = $1', [id]);
  };
  if (client) await remove(client);
  else await transaction(remove);
  return ids.size;
}

// Distinct team names appearing in ACTIVE tournaments' matches for one game -
// the Liquipedia enrichment job's target set (its scope is always the tracked
// scene, never a wiki-wide crawl).
export async function listTrackedTeamNamesForGame(game, { ewcOnly = false } = {}) {
  // Same EWC scoping as listStandingsTeamNamesForGame (see EWC_TOURNAMENT_SQL there).
  const ewcSql = ewcOnly ? `AND ${EWC_TOURNAMENT_SQL}` : '';
  const rows = await all(
    `SELECT DISTINCT name FROM (
       SELECT m.team_a AS name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_a IS NOT NULL AND m.team_a <> '' ${ewcSql}
       UNION
       SELECT m.team_b AS name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_b IS NOT NULL AND m.team_b <> '' ${ewcSql}
      ) AS names
      ORDER BY name ASC`,
    [game],
  );
  return rows.map((row) => row.name);
}

// game -> soonest upcoming match time (unix seconds) across active tournaments.
// `sinceSec` should sit a few hours in the past so a LIVE event still counts as
// "now". Games with no upcoming scheduled match are absent. Drives the
// enrichment job's nearest-event-first ordering: the game whose tournament
// plays next gets the budget first.
export async function listGameNextMatchAt(sinceSec) {
  return all(
    `SELECT t.game AS game, MIN(m.scheduled_at) AS next_at
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
      WHERE t.active = 1 AND t.archived_at IS NULL
        AND m.scheduled_at IS NOT NULL AND m.scheduled_at >= $1
      GROUP BY t.game`,
    [sinceSec],
  );
}

// Match team rows WITH their tournament's identity, for the EWC weekly-pick
// scoping's JS-side event filtering (see listStandingsTeamRowsForGame).
export async function listTrackedTeamRowsForGame(game, { ewcOnly = false } = {}) {
  const ewcSql = ewcOnly ? `AND ${EWC_TOURNAMENT_SQL}` : '';
  return all(
    `SELECT DISTINCT team, tournament_path, tournament_name FROM (
       SELECT m.team_a AS team, t.external_id AS tournament_path, t.name AS tournament_name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_a IS NOT NULL AND m.team_a <> '' ${ewcSql}
       UNION
       SELECT m.team_b AS team, t.external_id AS tournament_path, t.name AS tournament_name FROM matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL AND m.team_b IS NOT NULL AND m.team_b <> '' ${ewcSql}
      ) AS names
      ORDER BY team ASC`,
    [game],
  );
}

export async function getMatchById(id) {
  return get('SELECT * FROM matches WHERE id = $1', [id]);
}

// Pin a result an operator entered by hand. Locking is what makes it survive: the
// official feed re-derives Overwatch series scores from the sheet on every poll and
// would otherwise overwrite this within seconds.
export async function setManualMatchResult({
  matchId,
  scoreA,
  scoreB,
  status = 'finished',
  actorId = null,
  client = null,
}) {
  const a = scoreA == null ? null : Number(scoreA);
  const b = scoreB == null ? null : Number(scoreB);
  if (status === 'finished' && (!Number.isFinite(a) || !Number.isFinite(b))) {
    throw new Error('A finished result needs both scores.');
  }
  // The matches CHECK constraint ties these together: only a finished row may carry a
  // winner or a real result reason.
  const finished = status === 'finished';
  const winnerSide = !finished ? null : a === b ? 'draw' : a > b ? 'team1' : 'team2';
  const resultReason = finished ? 'normal' : status === 'cancelled' ? 'cancelled' : status === 'postponed' ? 'postponed' : 'unknown';
  const runner = client || { run, get };
  await runner.run(
    `UPDATE matches
        SET score_a = $1, score_b = $2, status = $3, winner_side = $4, result_reason = $5,
            result_locked_at = $6, result_locked_by = $7, updated_at = $6
      WHERE id = $8`,
    [finished ? a : null, finished ? b : null, status, winnerSide, resultReason, nowText(), actorId, matchId],
  );
  return runner.get('SELECT * FROM matches WHERE id = $1', [matchId]);
}

// Release the pin so providers own the result again.
export async function clearManualMatchResult(matchId, { client = null } = {}) {
  const runner = client || { run, get };
  await runner.run(
    'UPDATE matches SET result_locked_at = NULL, result_locked_by = NULL, updated_at = $1 WHERE id = $2',
    [nowText(), matchId],
  );
  return runner.get('SELECT * FROM matches WHERE id = $1', [matchId]);
}
