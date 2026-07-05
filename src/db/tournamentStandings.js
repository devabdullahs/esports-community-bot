import { all, transaction } from './client.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Replace a tournament's standings atomically. Sections arrive in page order;
// the section index keeps that order stable for display.
export async function replaceTournamentStandings(tournamentId, sections) {
  const now = nowText();
  return transaction(async (tx) => {
    await tx.run('DELETE FROM tournament_standings WHERE tournament_id = $1', [tournamentId]);
    let inserted = 0;
    let sectionOrder = 0;
    for (const section of sections ?? []) {
      sectionOrder += 1;
      for (const entry of section.entries ?? []) {
        if (!entry?.team) continue;
        await tx.run(
          `INSERT INTO tournament_standings (tournament_id, section, section_order, rank, team, logo, points, extra, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            tournamentId,
            String(section.title ?? ''),
            sectionOrder,
            Number(entry.rank) || 0,
            String(entry.team),
            entry.logo ?? null,
            String(entry.points ?? ''),
            String(entry.extra ?? ''),
            now,
          ],
        );
        inserted += 1;
      }
    }
    return inserted;
  });
}

export async function listStandingsForTournament(tournamentId) {
  return all(
    `SELECT * FROM tournament_standings WHERE tournament_id = $1
     ORDER BY section_order ASC, rank ASC, id ASC`,
    [tournamentId],
  );
}

// Distinct participant team names from active, non-archived tournaments'
// standings for one game. Battle-royale + TFT events have no head-to-head
// matches, so their participants live here rather than in `matches`; the
// Liquipedia enrichment job unions this with the match-based tracked names so
// those participants (and their rosters) get enriched too.
// `ewcOnly` restricts to Esports World Cup events (weekly-pick options must not
// include teams from unrelated tracked tournaments, e.g. LCK teams in an EWC LoL
// pick). The `ewc` flag is the primary signal, but detection can miss (some EWC
// events carry ewc=0), so an EWC name/path match backs it up — same detection idea
// as isEwcMatch in lib/games.js. LIKE's `_` wildcard lets ONE portable pattern
// cover both "Esports_World_Cup" page paths and "Esports World Cup" display names.
export const EWC_TOURNAMENT_SQL = `(
  t.ewc = 1
  OR LOWER(COALESCE(t.name, '')) LIKE '%esports_world_cup%'
  OR LOWER(COALESCE(t.external_id, '')) LIKE '%esports_world_cup%'
)`;

export async function listStandingsTeamNamesForGame(game, { ewcOnly = false } = {}) {
  const rows = await all(
    `SELECT DISTINCT s.team AS name
       FROM tournament_standings s
       JOIN tournaments t ON t.id = s.tournament_id
      WHERE t.game = $1 AND t.active = 1 AND t.archived_at IS NULL
        AND s.team IS NOT NULL AND s.team <> '' AND UPPER(s.team) <> 'TBD'
        ${ewcOnly ? `AND ${EWC_TOURNAMENT_SQL}` : ''}
      ORDER BY name ASC`,
    [game],
  );
  return rows.map((row) => row.name);
}

// Distinct standings crest URLs across active, non-archived tournaments. All
// standings come from Liquipedia, so the logo-warmup job pre-downloads these
// into the shared cache; the web logo proxy never fetches Liquipedia upstream
// on a public page view (hotlinking Liquipedia images is not allowed).
export async function listStandingsLogos() {
  const rows = await all(
    `SELECT DISTINCT s.logo
       FROM tournament_standings s
       JOIN tournaments t ON t.id = s.tournament_id
      WHERE t.active = 1 AND t.archived_at IS NULL
        AND s.logo IS NOT NULL AND s.logo <> ''`,
    [],
  );
  return rows.map((row) => row.logo).filter(Boolean);
}

// tournament_id -> row count, for cheap "does this event have standings" checks
// across a whole listing (the directory must not hide match-less BR events).
export async function listStandingsCounts() {
  return all(
    'SELECT tournament_id, COUNT(*) AS count FROM tournament_standings GROUP BY tournament_id',
    [],
  );
}
