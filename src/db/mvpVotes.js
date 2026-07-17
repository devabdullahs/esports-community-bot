import { all, get, transaction } from './client.js';

const RIYADH_OFFSET_SECONDS = 3 * 60 * 60;
const MAX_NOMINEES = 8;

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function normalized(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function riyadhMvpWindow(nowSeconds = Math.floor(Date.now() / 1000)) {
  const shifted = new Date((nowSeconds + RIYADH_OFFSET_SECONDS) * 1000);
  const currentDate = shifted.toISOString().slice(0, 10);
  const currentMidnightAsUtc = Date.parse(`${currentDate}T00:00:00Z`) / 1000;
  const opensAt = currentMidnightAsUtc - RIYADH_OFFSET_SECONDS;
  const voteDate = new Date((currentMidnightAsUtc - 86400) * 1000).toISOString().slice(0, 10);
  return {
    voteDate,
    opensAt,
    closesAt: opensAt + 86400,
    matchStart: opensAt - 86400,
    matchEnd: opensAt,
  };
}

function playerScore(kind, player) {
  if (kind === 'valorant') {
    return finite(player.acs) + finite(player.kills) * 5 + finite(player.assists) * 2
      - finite(player.deaths) * 2 + finite(player.adr) * 0.25;
  }
  if (kind === 'dota2') {
    return finite(player.kills) * 15 + finite(player.assists) * 4
      - finite(player.deaths) * 5 + finite(player.gpm) * 0.15;
  }
  return 0;
}

function candidatesFromMatch(row) {
  let payload;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return [];
  }
  const kind = payload?.kind;
  const rounds = kind === 'valorant' ? payload?.maps : kind === 'dota2' ? payload?.games : null;
  if (!Array.isArray(rounds) || !rounds.length) return [];

  const aggregate = new Map();
  for (const round of rounds) {
    for (const side of ['a', 'b']) {
      const players = round?.players?.[side];
      if (!Array.isArray(players)) continue;
      for (const player of players) {
        const name = String(player?.name || '').trim();
        if (!name) continue;
        const key = `${side}:${normalized(name)}`;
        const current = aggregate.get(key) || { name, side, score: 0, rounds: 0 };
        current.score += playerScore(kind, player);
        current.rounds += 1;
        aggregate.set(key, current);
      }
    }
  }

  return [...aggregate.values()]
    .map((player) => ({
      displayName: player.name,
      teamName: player.side === 'a' ? row.team_a : row.team_b,
      game: String(row.game || kind),
      sourceMatchId: Number(row.match_id),
      performanceScore: player.rounds ? player.score / player.rounds : 0,
    }))
    .sort((a, b) => b.performanceScore - a.performanceScore || a.displayName.localeCompare(b.displayName))
    .slice(0, 2);
}

async function buildCandidates({ matchStart, matchEnd }) {
  const detailRows = await all(
    `SELECT md.match_id, md.game, md.payload_json, m.team_a, m.team_b
     FROM match_details md
     JOIN matches m ON m.id = md.match_id
     WHERE m.status = 'finished'
       AND m.scheduled_at >= $1 AND m.scheduled_at < $2
     ORDER BY m.scheduled_at DESC, m.id DESC`,
    [matchStart, matchEnd],
  );
  const ranked = detailRows.flatMap(candidatesFromMatch)
    .sort((a, b) => b.performanceScore - a.performanceScore || a.displayName.localeCompare(b.displayName));

  const playerRows = await all(
    `SELECT id, game, name, slug, image_url, current_team_name
     FROM players
     WHERE name IS NOT NULL`,
  );
  const playerIndex = new Map();
  for (const player of playerRows) {
    playerIndex.set(`${normalized(player.game)}:${normalized(player.name)}`, player);
    if (player.slug) playerIndex.set(`${normalized(player.game)}:${normalized(player.slug)}`, player);
  }

  const seen = new Set();
  const candidates = [];
  for (const candidate of ranked) {
    const nomineeKey = `${normalized(candidate.game)}:${normalized(candidate.displayName)}`;
    if (!normalized(candidate.displayName) || seen.has(nomineeKey)) continue;
    seen.add(nomineeKey);
    const player = playerIndex.get(nomineeKey) || null;
    candidates.push({
      ...candidate,
      nomineeKey,
      playerId: player?.id ?? null,
      imageUrl: player?.image_url ?? null,
      teamName: candidate.teamName || player?.current_team_name || null,
    });
    if (candidates.length >= MAX_NOMINEES) break;
  }
  return candidates;
}

export async function ensureDailyMvpSession(nowSeconds = Math.floor(Date.now() / 1000)) {
  const window = riyadhMvpWindow(nowSeconds);
  const existing = await get('SELECT * FROM mvp_vote_sessions WHERE vote_date = $1', [window.voteDate]);
  if (existing) return existing;

  const candidates = await buildCandidates(window);
  return transaction(async (tx) => {
    const session = await tx.get(
      `INSERT INTO mvp_vote_sessions (vote_date, opens_at, closes_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (vote_date) DO UPDATE SET vote_date = excluded.vote_date
       RETURNING *`,
      [window.voteDate, window.opensAt, window.closesAt],
    );
    const count = await tx.get('SELECT COUNT(*) AS count FROM mvp_vote_nominees WHERE session_id = $1', [session.id]);
    if (Number(count?.count || 0) === 0) {
      for (const candidate of candidates) {
        await tx.run(
          `INSERT INTO mvp_vote_nominees
             (session_id, player_id, source_match_id, nominee_key, display_name, team_name, game, image_url, performance_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (session_id, nominee_key) DO NOTHING`,
          [session.id, candidate.playerId, candidate.sourceMatchId, candidate.nomineeKey,
            candidate.displayName, candidate.teamName, candidate.game, candidate.imageUrl,
            candidate.performanceScore],
        );
      }
    }
    return session;
  });
}

async function sessionProjection(session, discordUserId, nowSeconds) {
  if (!session) return null;
  const selected = discordUserId
    ? await get('SELECT nominee_id FROM mvp_votes WHERE session_id = $1 AND discord_user_id = $2', [session.id, discordUserId])
    : null;
  const closed = nowSeconds >= Number(session.closes_at);
  const revealCounts = closed || Boolean(selected);
  const nominees = await all(
    `SELECT n.id, n.player_id, n.display_name, n.team_name, n.game, n.image_url,
            ${revealCounts ? 'COUNT(v.nominee_id)' : '0'} AS vote_count
     FROM mvp_vote_nominees n
     LEFT JOIN mvp_votes v ON v.session_id = n.session_id AND v.nominee_id = n.id
     WHERE n.session_id = $1
     GROUP BY n.id, n.player_id, n.display_name, n.team_name, n.game, n.image_url, n.performance_score
     ORDER BY ${revealCounts ? 'vote_count DESC,' : ''} n.performance_score DESC, lower(n.display_name), n.id`,
    [session.id],
  );
  return {
    id: Number(session.id),
    voteDate: session.vote_date,
    opensAt: Number(session.opens_at),
    closesAt: Number(session.closes_at),
    closed,
    revealCounts,
    selectedNomineeId: selected ? Number(selected.nominee_id) : null,
    nominees: nominees.map((nominee) => ({
      id: Number(nominee.id),
      playerId: nominee.player_id == null ? null : Number(nominee.player_id),
      displayName: nominee.display_name,
      teamName: nominee.team_name || null,
      game: nominee.game,
      imageUrl: nominee.image_url || null,
      voteCount: revealCounts ? Number(nominee.vote_count || 0) : null,
    })),
  };
}

/**
 * @param {{ nowSeconds?: number, discordUserId?: string | null }} [options]
 */
export async function getCurrentMvpVote({ nowSeconds = Math.floor(Date.now() / 1000), discordUserId = null } = {}) {
  const session = await ensureDailyMvpSession(nowSeconds);
  return sessionProjection(session, discordUserId, nowSeconds);
}

export class MvpVoteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function castMvpVote({ sessionId, nomineeId, discordUserId, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !Number.isSafeInteger(nomineeId) || nomineeId <= 0) {
    throw new MvpVoteError('invalid', 'Invalid MVP vote.');
  }
  if (!String(discordUserId || '').trim()) throw new MvpVoteError('invalid', 'Invalid member.');

  await transaction(async (tx) => {
    const session = await tx.get('SELECT * FROM mvp_vote_sessions WHERE id = $1', [sessionId]);
    if (!session) throw new MvpVoteError('not_found', 'MVP vote not found.');
    if (nowSeconds < Number(session.opens_at) || nowSeconds >= Number(session.closes_at)) {
      throw new MvpVoteError('closed', 'Voting is closed.');
    }
    const nominee = await tx.get(
      'SELECT id FROM mvp_vote_nominees WHERE session_id = $1 AND id = $2',
      [sessionId, nomineeId],
    );
    if (!nominee) throw new MvpVoteError('invalid_nominee', 'Nominee is not part of this vote.');
    const now = nowText();
    await tx.run(
      `INSERT INTO mvp_votes (session_id, nominee_id, discord_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (session_id, discord_user_id) DO UPDATE SET
         nominee_id = excluded.nominee_id,
         updated_at = excluded.updated_at`,
      [sessionId, nomineeId, String(discordUserId), now],
    );
  });
  const session = await get('SELECT * FROM mvp_vote_sessions WHERE id = $1', [sessionId]);
  return sessionProjection(session, discordUserId, nowSeconds);
}

export async function getLatestClosedMvpResult(nowSeconds = Math.floor(Date.now() / 1000)) {
  const session = await get(
    `SELECT * FROM mvp_vote_sessions
     WHERE closes_at <= $1
     ORDER BY closes_at DESC, id DESC
     LIMIT 1`,
    [nowSeconds],
  );
  const projected = await sessionProjection(session, null, nowSeconds);
  if (!projected?.nominees.length) return null;
  const winner = projected.nominees[0];
  if (!winner || Number(winner.voteCount || 0) < 1) return null;
  return { voteDate: projected.voteDate, closesAt: projected.closesAt, winner };
}

export async function getLatestMvpWinForPlayer(playerId, nowSeconds = Math.floor(Date.now() / 1000)) {
  const row = await get(
    `WITH ranked AS (
       SELECT s.vote_date, s.closes_at, n.player_id,
              COUNT(v.nominee_id) AS vote_count,
              DENSE_RANK() OVER (
                PARTITION BY s.id
                ORDER BY COUNT(v.nominee_id) DESC
              ) AS vote_rank
       FROM mvp_vote_sessions s
       JOIN mvp_vote_nominees n ON n.session_id = s.id
       LEFT JOIN mvp_votes v ON v.session_id = s.id AND v.nominee_id = n.id
       WHERE s.closes_at <= $1
       GROUP BY s.id, s.vote_date, s.closes_at, n.id, n.player_id
     )
     SELECT vote_date, vote_count
     FROM ranked
     WHERE player_id = $2 AND vote_rank = 1 AND vote_count > 0
     ORDER BY closes_at DESC
     LIMIT 1`,
    [nowSeconds, playerId],
  );
  return row ? { voteDate: row.vote_date, voteCount: Number(row.vote_count || 0) } : null;
}
