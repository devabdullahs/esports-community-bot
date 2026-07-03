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

// tournament_id -> row count, for cheap "does this event have standings" checks
// across a whole listing (the directory must not hide match-less BR events).
export async function listStandingsCounts() {
  return all(
    'SELECT tournament_id, COUNT(*) AS count FROM tournament_standings GROUP BY tournament_id',
    [],
  );
}
