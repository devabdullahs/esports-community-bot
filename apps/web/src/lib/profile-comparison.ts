import "server-only";

import { all } from "@bot/db/client.js";
import { getProfileMatchesForTeamNamesCached } from "@/lib/profile-matches";

export type ComparisonKind = "team" | "player";

export type ComparisonSelection = {
  kind: ComparisonKind;
  leftId: number | null;
  rightId: number | null;
};

export type ComparisonRosterEntry = {
  id: number;
  name: string;
  role: string | null;
  imageUrl: string | null;
  profilePath: string;
};

export type ComparisonMatch = {
  id: number;
  teamA: string | null;
  teamB: string | null;
  tournamentName: string | null;
  status: "scheduled" | "running";
  scheduledAt: number | null;
};

export type ComparisonProfile = {
  id: number;
  kind: ComparisonKind;
  name: string;
  imageUrl: string | null;
  game: string | null;
  region: string | null;
  currentTeam: string | null;
  currentTeamId: number | null;
  role: string | null;
  approximateWinnings: string | null;
  achievements: string[];
  achievementCount: number;
  activeRoster: ComparisonRosterEntry[];
  recentMatches: ComparisonMatch[];
  profilePath: string;
};

export type ComparisonSearchOption = {
  id: number;
  name: string;
  game: string | null;
  imageUrl: string | null;
  detail: string | null;
};

type TeamComparisonRow = {
  id: number;
  game: string | null;
  name: string;
  acronym: string | null;
  nationality: string | null;
  image_url: string | null;
  location: string | null;
  liquipedia_facts: string | null;
};

type PlayerComparisonRow = {
  id: number;
  game: string | null;
  name: string;
  nationality: string | null;
  image_url: string | null;
  role: string | null;
  current_team_id: number | null;
  current_team_name: string | null;
  resolved_team_id: number | null;
  resolved_team_name: string | null;
  liquipedia_facts: string | null;
};

type RosterRow = {
  id: number;
  name: string;
  role: string | null;
  image_url: string | null;
};

type SearchRow = {
  id: number;
  name: string;
  game: string | null;
  image_url: string | null;
  detail: string | null;
};

const MAX_ID = 2_147_483_647;
export const MAX_COMPARISON_SEARCH_QUERY = 80;
export const MAX_COMPARISON_SEARCH_RESULTS = 12;
const MAX_ROSTER_ENTRIES = 12;
const MAX_RECENT_MATCHES = 3;
const MAX_ACHIEVEMENTS = 6;
const MAX_PUBLIC_TEXT_LENGTH = 240;

function firstString(value: string | string[] | undefined | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function publicText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, MAX_PUBLIC_TEXT_LENGTH);
  return text || null;
}

function publicFacts(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function publicAchievements(facts: Record<string, unknown>) {
  if (!Array.isArray(facts.achievements)) return [];
  const titles = facts.achievements.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const title = publicText((entry as Record<string, unknown>).title);
    return title ? [title] : [];
  });
  return [...new Set(titles)].slice(0, MAX_ACHIEVEMENTS);
}

function publicWinnings(facts: Record<string, unknown>) {
  const value = publicText(facts.approx_total_winnings)
    ?? publicText(facts.total_winnings)
    ?? publicText(facts.earnings);
  return value?.replace(/^\$+/, "$") ?? null;
}

function publicMatches(matches: Awaited<ReturnType<typeof getProfileMatchesForTeamNamesCached>>) {
  return [...matches.running, ...matches.scheduled]
    .slice(0, MAX_RECENT_MATCHES)
    .flatMap((match): ComparisonMatch[] => {
      if (match.status !== "running" && match.status !== "scheduled") return [];
      return [{
        id: match.id,
        teamA: publicText(match.team_a),
        teamB: publicText(match.team_b),
        tournamentName: publicText(match.tournament_name),
        status: match.status,
        scheduledAt: match.scheduled_at != null && Number.isFinite(match.scheduled_at)
          ? match.scheduled_at
          : null,
      }];
    });
}

function rosterEntry(row: RosterRow): ComparisonRosterEntry {
  return {
    id: row.id,
    name: publicText(row.name) ?? "",
    role: publicText(row.role),
    imageUrl: publicText(row.image_url),
    profilePath: `/players/${row.id}`,
  };
}

function teamProfile(
  row: TeamComparisonRow,
  roster: RosterRow[],
  matches: ComparisonMatch[],
): ComparisonProfile {
  const facts = publicFacts(row.liquipedia_facts);
  const achievements = publicAchievements(facts);
  return {
    id: row.id,
    kind: "team",
    name: publicText(row.name) ?? "",
    imageUrl: publicText(row.image_url),
    game: publicText(row.game),
    region: publicText(facts.region) ?? publicText(facts.location) ?? publicText(row.location) ?? publicText(row.nationality),
    currentTeam: null,
    currentTeamId: null,
    role: null,
    approximateWinnings: publicWinnings(facts),
    achievements,
    achievementCount: achievements.length,
    activeRoster: roster.map(rosterEntry),
    recentMatches: matches,
    profilePath: `/teams/${row.id}`,
  };
}

function playerProfile(row: PlayerComparisonRow, matches: ComparisonMatch[]): ComparisonProfile {
  const facts = publicFacts(row.liquipedia_facts);
  const achievements = publicAchievements(facts);
  return {
    id: row.id,
    kind: "player",
    name: publicText(row.name) ?? "",
    imageUrl: publicText(row.image_url),
    game: publicText(row.game),
    region: publicText(row.nationality),
    currentTeam: publicText(row.resolved_team_name) ?? publicText(row.current_team_name) ?? publicText(facts.team) ?? publicText(facts.current_team),
    currentTeamId: row.resolved_team_id ?? row.current_team_id ?? null,
    role: publicText(facts.status) ?? publicText(row.role),
    approximateWinnings: publicWinnings(facts),
    achievements,
    achievementCount: achievements.length,
    activeRoster: [],
    recentMatches: matches,
    profilePath: `/players/${row.id}`,
  };
}

export function parseComparisonKind(value: string | string[] | undefined | null): ComparisonKind | null {
  const raw = firstString(value)?.trim().toLowerCase();
  return raw === "team" || raw === "player" ? raw : null;
}

export function parseComparisonId(value: string | string[] | undefined | null): number | null {
  const raw = firstString(value)?.trim();
  if (!raw || raw.length > 10 || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

export function parseComparisonSelection(params: Record<string, string | string[] | undefined>): ComparisonSelection {
  const kind = parseComparisonKind(params.kind) ?? "team";
  const leftId = parseComparisonId(params.left);
  const candidateRightId = parseComparisonId(params.right);
  return {
    kind,
    leftId,
    rightId: candidateRightId === leftId ? null : candidateRightId,
  };
}

export function parseComparisonSearchQuery(value: string | string[] | undefined | null): string | null {
  const raw = firstString(value);
  if (raw == null || raw.length > MAX_COMPARISON_SEARCH_QUERY) return null;
  return raw.trim();
}

async function listTeamRows(ids: number[]) {
  if (!ids.length) return [];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  return all(
    `SELECT id, game, name, acronym, nationality, image_url, location, liquipedia_facts
       FROM teams
      WHERE id IN (${placeholders})`,
    ids,
  ) as Promise<TeamComparisonRow[]>;
}

async function listPlayerRows(ids: number[]) {
  if (!ids.length) return [];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  return all(
    `SELECT p.id, p.game, p.name, p.nationality, p.image_url, p.role,
            p.current_team_id, p.current_team_name, p.liquipedia_facts,
            t.id AS resolved_team_id, t.name AS resolved_team_name
       FROM players p
       LEFT JOIN teams t ON t.id = p.current_team_id
      WHERE p.id IN (${placeholders})`,
    ids,
  ) as Promise<PlayerComparisonRow[]>;
}

async function listRoster(teamId: number) {
  return all(
    `SELECT id, name, role, image_url
       FROM players
      WHERE current_team_id = $1
      ORDER BY lower(name) ASC, id ASC
      LIMIT $2`,
    [teamId, MAX_ROSTER_ENTRIES],
  ) as Promise<RosterRow[]>;
}

function requestedIds(selection: ComparisonSelection) {
  return [selection.leftId, selection.rightId].filter((id): id is number => id != null);
}

export async function getProfileComparison(selection: ComparisonSelection) {
  const ids = requestedIds(selection);
  if (!ids.length) return { left: null, right: null };

  if (selection.kind === "team") {
    const rows = await listTeamRows(ids);
    const matchesById = new Map(await Promise.all(rows.map(async (row) => [
      row.id,
      publicMatches(await getProfileMatchesForTeamNamesCached({
        game: row.game,
        names: [row.name, row.acronym],
        limit: MAX_RECENT_MATCHES,
      })),
    ] as const)));
    const rostersById = new Map(await Promise.all(rows.map(async (row) => [row.id, await listRoster(row.id)] as const)));
    const byId = new Map(rows.map((row) => [
      row.id,
      teamProfile(row, rostersById.get(row.id) ?? [], matchesById.get(row.id) ?? []),
    ]));
    return {
      left: selection.leftId ? byId.get(selection.leftId) ?? null : null,
      right: selection.rightId ? byId.get(selection.rightId) ?? null : null,
    };
  }

  const rows = await listPlayerRows(ids);
  const matchesById = new Map(await Promise.all(rows.map(async (row) => [
    row.id,
    publicMatches(await getProfileMatchesForTeamNamesCached({
      game: row.game,
      names: [row.resolved_team_name, row.current_team_name],
      limit: MAX_RECENT_MATCHES,
    })),
  ] as const)));
  const byId = new Map(rows.map((row) => [
    row.id,
    playerProfile(row, matchesById.get(row.id) ?? []),
  ]));
  return {
    left: selection.leftId ? byId.get(selection.leftId) ?? null : null,
    right: selection.rightId ? byId.get(selection.rightId) ?? null : null,
  };
}

export async function searchComparisonProfiles(kind: ComparisonKind, query: string) {
  const parsedQuery = parseComparisonSearchQuery(query);
  if (parsedQuery === null) return [];

  const like = `%${parsedQuery.toLowerCase()}%`;
  const rows = kind === "team"
    ? await all(
      `SELECT id, name, game, image_url, acronym AS detail
         FROM teams
        WHERE lower(name) LIKE $1 OR lower(slug) LIKE $1
        ORDER BY lower(name) ASC, id ASC
        LIMIT $2`,
      [like, MAX_COMPARISON_SEARCH_RESULTS],
    ) as SearchRow[]
    : await all(
      `SELECT id, name, game, image_url, COALESCE(role, current_team_name) AS detail
         FROM players
        WHERE lower(name) LIKE $1 OR lower(slug) LIKE $1
        ORDER BY lower(name) ASC, id ASC
        LIMIT $2`,
      [like, MAX_COMPARISON_SEARCH_RESULTS],
    ) as SearchRow[];

  return rows.flatMap((row): ComparisonSearchOption[] => {
    const name = publicText(row.name);
    return name ? [{
      id: row.id,
      name,
      game: publicText(row.game),
      imageUrl: publicText(row.image_url),
      detail: publicText(row.detail),
    }] : [];
  });
}
