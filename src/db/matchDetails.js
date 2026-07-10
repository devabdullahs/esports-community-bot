import { get, run } from './client.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function upsertMatchDetails({ matchId, sourcePage, game, payload }) {
  const now = nowText();
  return run(
    `INSERT INTO match_details (match_id, source_page, game, payload_json, fetched_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (match_id) DO UPDATE SET
       source_page = excluded.source_page,
       game = excluded.game,
       payload_json = excluded.payload_json,
       fetched_at = excluded.fetched_at,
       updated_at = excluded.updated_at`,
    [matchId, sourcePage, game, JSON.stringify(payload), now],
  );
}

export async function getMatchDetails(matchId) {
  const row = await get('SELECT * FROM match_details WHERE match_id = $1', [matchId]);
  if (!row) return null;
  try {
    return { ...row, payload: JSON.parse(row.payload_json) };
  } catch {
    return null;
  }
}

export async function getMatchDetailsFetchedAt(matchId) {
  const row = await get('SELECT fetched_at FROM match_details WHERE match_id = $1', [matchId]);
  return row?.fetched_at ?? null;
}
