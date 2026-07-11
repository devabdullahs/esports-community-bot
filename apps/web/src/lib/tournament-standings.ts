export type TournamentStandingLike = {
  section: string;
  rank: number;
  points?: string | null;
  extra?: string | null;
};

const EWC_POINTS_BY_RANK = new Map([
  [1, 1000],
  [2, 750],
  [3, 500],
  [4, 300],
  [5, 200],
  [6, 150],
  [7, 100],
  [8, 50],
]);

function finalSectionPriority(section: string): number {
  const normalized = section.trim().toLowerCase().replace(/\bfinals\b/g, "final");
  if (/\bgrand final\b/.test(normalized)) return 4;
  if (/\bfinal standings\b/.test(normalized)) return 3;
  if (/\boverall standings\b/.test(normalized)) return 2;
  if (/(?:^|:)\s*final\s*$/.test(normalized)) return 1;
  return 0;
}

export function finalTournamentStandingSection(rows: readonly TournamentStandingLike[]): string | null {
  const sections = [...new Set(rows.map((row) => row.section.trim()).filter(Boolean))];
  if (!sections.length) return null;
  const semantic = sections
    .map((section, index) => ({ section, index, priority: finalSectionPriority(section) }))
    .filter(({ priority }) => priority > 0)
    .sort((a, b) => b.priority - a.priority || b.index - a.index)[0];
  return semantic?.section ?? sections.at(-1) ?? null;
}

export function ewcPlacementPointsForRank(rank: number): number {
  return EWC_POINTS_BY_RANK.get(Number(rank)) ?? 0;
}
