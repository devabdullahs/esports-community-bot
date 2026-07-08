import "server-only";

import { unstable_cache } from "next/cache";
import { all } from "@bot/db/client.js";
import { clubNameKeys as botClubNameKeys } from "@bot/lib/ewcPredictions.js";
import {
  classifyClubRegion,
  clubKey,
  clubKeys,
  isFeaturedClubName,
  type ClubRegionId,
} from "@/lib/ewc-club-regions";
import { gameTitleForSlug, listGames } from "@/lib/games";

const CLUBS_SOURCE_URL = "https://liquipedia.net/esports/Esports_World_Cup/2026/Clubs";
const STANDINGS_SOURCE_URL =
  "https://liquipedia.net/esports/Esports_World_Cup/2026/Club_Championship_Standings";

type RawEwcClubGame = {
  label?: string | null;
  shortLabel?: string | null;
  pageUrl?: string | null;
  icon?: string | null;
  status?: string | null;
  entries?: Array<{ name?: string | null; wiki?: string | null; url?: string | null; status?: string | null }>;
};

type RawEwcClub = {
  name?: string | null;
  pageUrl?: string | null;
  logo?: string | null;
  clubSupportProgram?: boolean | null;
  qualifiedCount?: number | null;
  possibleEvents?: number | null;
  totalTeams?: number | null;
  games?: RawEwcClubGame[];
};

type RawStanding = {
  rank?: number | string | null;
  team?: string | null;
  points?: number | string | null;
  eligibility?: string | null;
};

type TeamProfileRow = {
  name: string | null;
  image_url: string | null;
  location: string | null;
  nationality: string | null;
  liquipedia_facts: string | null;
};

export type EwcClubGame = {
  label: string;
  shortLabel: string;
  pageUrl: string | null;
  icon: string | null;
  status: string;
  entries: Array<{ name: string; wiki: string | null; url: string | null; status: string | null }>;
};

export type EwcClubWin = {
  game: string;
  event: string | null;
  url: string | null;
  source: "prediction-results";
};

export type EwcClubTrackerClub = {
  name: string;
  pageUrl: string | null;
  logo: string | null;
  supportProgram: boolean;
  featured: boolean;
  region: Exclude<ClubRegionId, "all">;
  regionSource: "featured" | "profile" | "unknown";
  locationLabel: string | null;
  rank: number | null;
  points: number | null;
  eligibility: string | null;
  qualifiedCount: number;
  possibleEvents: number;
  totalTeams: number;
  games: EwcClubGame[];
  qualifiedGames: EwcClubGame[];
  possibleGames: EwcClubGame[];
  wins: EwcClubWin[];
};

export type EwcClubTracker = {
  sourceUrl: string;
  standingsSourceUrl: string;
  updatedAt: string;
  dataSource?: "liquipedia" | "database-fallback";
  warning?: string;
  clubs: EwcClubTrackerClub[];
  summary: {
    total: number;
    featured: number;
    qualifiedGames: number;
    confirmedWins: number;
    pointsLeader: { name: string; points: number; rank: number | null } | null;
  };
};

type FetchEwcClubs = () => Promise<{
  sourceUrl?: string;
  clubs?: RawEwcClub[];
}>;

type FetchEwcClubStandings = (year?: number) => Promise<{
  sourceUrl?: string;
  standings?: RawStanding[];
}>;

async function liquipediaFetchers() {
  const mod = (await import("@bot/services/liquipedia.js")) as {
    fetchEwcClubs: FetchEwcClubs;
    fetchEwcClubStandings: FetchEwcClubStandings;
  };
  return mod;
}

function parseFacts(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function profileScore(profile: TeamProfileRow & { facts: Record<string, unknown> | null }) {
  return (
    (profile.location ? 4 : 0) +
    (profile.nationality ? 2 : 0) +
    (profile.facts && Object.keys(profile.facts).length ? 1 : 0)
  );
}

async function teamProfilesByClubKey() {
  const rows = (await all(
    `SELECT name, image_url, location, nationality, liquipedia_facts
       FROM teams
      WHERE name IS NOT NULL AND name <> ''`,
    [],
  )) as TeamProfileRow[];
  const byKey = new Map<string, TeamProfileRow & { facts: Record<string, unknown> | null }>();
  for (const row of rows) {
    const facts = parseFacts(row.liquipedia_facts);
    const profile = { ...row, facts };
    for (const key of clubKeys(row.name)) {
      const current = byKey.get(key);
      if (!current || profileScore(profile) > profileScore(current)) byKey.set(key, profile);
    }
  }
  return byKey;
}

function addLookup<T>(map: Map<string, T>, name: unknown, value: T) {
  for (const key of botClubNameKeys(name)) {
    if (!map.has(key)) map.set(key, value);
  }
  for (const key of clubKeys(name)) {
    if (!map.has(key)) map.set(key, value);
  }
}

function lookupByClubName<T>(map: Map<string, T>, name: unknown): T | null {
  for (const key of botClubNameKeys(name)) {
    const value = map.get(key);
    if (value) return value;
  }
  for (const key of clubKeys(name)) {
    const value = map.get(key);
    if (value) return value;
  }
  return null;
}

async function standingsByClubKey() {
  try {
    const { fetchEwcClubStandings } = await liquipediaFetchers();
    const payload = await fetchEwcClubStandings(2026);
    const map = new Map<string, { rank: number | null; points: number | null; eligibility: string | null }>();
    for (const row of payload.standings ?? []) {
      if (!row.team) continue;
      addLookup(map, row.team, {
        rank: numberValue(row.rank),
        points: numberValue(row.points),
        eligibility: stringValue(row.eligibility),
      });
    }
    return map;
  } catch {
    return new Map<string, { rank: number | null; points: number | null; eligibility: string | null }>();
  }
}

function parseResultsJson(value: unknown): unknown[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanWinLabel(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function winKey(win: EwcClubWin) {
  return `${clubKey(win.game)}::${clubKey(win.event ?? "")}`;
}

function addWin(
  winsByClubKey: Map<string, Map<string, EwcClubWin>>,
  clubName: unknown,
  win: EwcClubWin,
) {
  const game = cleanWinLabel(win.game);
  if (!game) return;
  const cleanWin = {
    ...win,
    game,
    event: cleanWinLabel(win.event) || null,
  };
  for (const key of [...botClubNameKeys(clubName), ...clubKeys(clubName)]) {
    if (!key) continue;
    const bucket = winsByClubKey.get(key) ?? new Map<string, EwcClubWin>();
    bucket.set(winKey(cleanWin), cleanWin);
    winsByClubKey.set(key, bucket);
  }
}

async function winsByClubKey() {
  const wins = new Map<string, Map<string, EwcClubWin>>();
  const predictionRows = (await all(
    `SELECT results_json
       FROM ewc_prediction_weeks
      WHERE season = $1
        AND results_json IS NOT NULL
        AND TRIM(results_json) <> ''`,
    ["2026"],
  )) as Array<{ results_json: string | null }>;

  for (const row of predictionRows) {
    for (const result of parseResultsJson(row.results_json)) {
      if (!result || typeof result !== "object") continue;
      const record = result as Record<string, unknown>;
      const placements = Array.isArray(record.placements) ? record.placements : [];
      for (const placement of placements) {
        if (!placement || typeof placement !== "object") continue;
        const placementRecord = placement as Record<string, unknown>;
        if (Number(placementRecord.points) !== 1000 || !placementRecord.club) continue;
        addWin(wins, placementRecord.club, {
          game: cleanWinLabel(record.game) || cleanWinLabel(record.gameKey),
          event: cleanWinLabel(record.event) || null,
          url: null,
          source: "prediction-results",
        });
      }
    }
  }
  return wins;
}

function winsForClub(wins: Map<string, Map<string, EwcClubWin>>, name: string) {
  const out = new Map<string, EwcClubWin>();
  for (const key of [...botClubNameKeys(name), ...clubKeys(name)]) {
    const bucket = wins.get(key);
    if (!bucket) continue;
    for (const [id, win] of bucket) out.set(id, win);
  }
  return [...out.values()].sort((a, b) => a.game.localeCompare(b.game) || String(a.event).localeCompare(String(b.event)));
}

function normalizeGame(game: RawEwcClubGame): EwcClubGame {
  const label = stringValue(game.label) ?? stringValue(game.shortLabel) ?? "Unknown game";
  return {
    label,
    shortLabel: stringValue(game.shortLabel) ?? label,
    pageUrl: stringValue(game.pageUrl),
    icon: stringValue(game.icon),
    status: stringValue(game.status) ?? "unknown",
    entries: (game.entries ?? []).map((entry) => ({
      name: stringValue(entry.name) ?? stringValue(entry.wiki) ?? label,
      wiki: stringValue(entry.wiki),
      url: stringValue(entry.url),
      status: stringValue(entry.status),
    })),
  };
}

function ewcClubGameKey(game: Pick<EwcClubGame, "label" | "shortLabel" | "pageUrl">) {
  const pageUrl = stringValue(game.pageUrl);
  if (pageUrl) return `url:${pageUrl}`;
  const label = clubKey(game.label) || clubKey(game.shortLabel);
  return label ? `label:${label}` : null;
}

export function countUniqueQualifiedGames(clubs: Array<Pick<EwcClubTrackerClub, "qualifiedGames">>) {
  const seen = new Set<string>();
  for (const club of clubs) {
    for (const game of club.qualifiedGames) {
      const key = ewcClubGameKey(game);
      if (key) seen.add(key);
    }
  }
  return seen.size;
}

function parseStandingRowsJson(value: unknown): RawStanding[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as RawStanding[]) : [];
  } catch {
    return [];
  }
}

async function latestStoredStandingsRows(season = "2026") {
  const rows = (await all(
    `SELECT payload, updated_at
       FROM (
         SELECT final_json AS payload, COALESCE(scored_at, created_at) AS updated_at, id AS sort_id
           FROM ewc_prediction_weeks
          WHERE season = $1
            AND final_json IS NOT NULL
            AND TRIM(final_json) <> ''
         UNION ALL
         SELECT final_json AS payload, COALESCE(scored_at, created_at) AS updated_at, 0 AS sort_id
           FROM ewc_prediction_seasons
          WHERE season = $1
            AND final_json IS NOT NULL
            AND TRIM(final_json) <> ''
       ) snapshots
      ORDER BY updated_at DESC, sort_id DESC
      LIMIT 1`,
    [season],
  )) as Array<{ payload: string | null; updated_at: string | null }>;
  const latest = rows[0] ?? null;
  return {
    updatedAt: latest?.updated_at ?? null,
    standings: parseStandingRowsJson(latest?.payload),
  };
}

type StoredClubGameRow = {
  team: string | null;
  game: string | null;
  tournament_name: string | null;
};

async function storedEwcClubGameRows() {
  return (await all(
    `SELECT team, game, tournament_name
       FROM (
         SELECT s.team AS team, t.game AS game, t.name AS tournament_name
           FROM tournament_standings s
           JOIN tournaments t ON t.id = s.tournament_id
          WHERE t.ewc = 1
            AND t.active = 1
            AND t.archived_at IS NULL
         UNION ALL
         SELECT m.team_a AS team, t.game AS game, t.name AS tournament_name
           FROM matches m
           JOIN tournaments t ON t.id = m.tournament_id
          WHERE t.ewc = 1
            AND t.active = 1
            AND t.archived_at IS NULL
         UNION ALL
         SELECT m.team_b AS team, t.game AS game, t.name AS tournament_name
           FROM matches m
           JOIN tournaments t ON t.id = m.tournament_id
          WHERE t.ewc = 1
            AND t.active = 1
            AND t.archived_at IS NULL
       ) rows
      WHERE team IS NOT NULL
        AND TRIM(team) <> ''`,
    [],
  )) as StoredClubGameRow[];
}

function storedGameKey(row: StoredClubGameRow) {
  return String(row.game || row.tournament_name || "").trim();
}

function storedGameForRow(
  row: StoredClubGameRow,
  gameLabels: Map<string, string>,
): EwcClubGame | null {
  const slug = String(row.game || "").trim();
  const label = (slug ? gameLabels.get(slug) : null) || stringValue(row.tournament_name) || slug;
  if (!label) return null;
  return {
    label,
    shortLabel: label,
    pageUrl: null,
    icon: null,
    status: "qualified",
    entries: [],
  };
}

function gamesForClub(
  gamesByClubKey: Map<string, Map<string, EwcClubGame>>,
  name: string,
) {
  const out = new Map<string, EwcClubGame>();
  for (const key of [...botClubNameKeys(name), ...clubKeys(name)]) {
    const bucket = gamesByClubKey.get(key);
    if (!bucket) continue;
    for (const [id, game] of bucket) out.set(id, game);
  }
  return [...out.values()].sort((a, b) => a.shortLabel.localeCompare(b.shortLabel));
}

async function storedGamesByClubKey() {
  const [rows, games] = await Promise.all([storedEwcClubGameRows(), listGames().catch(() => [])]);
  const gameLabels = new Map(games.map((game) => [game.slug, gameTitleForSlug(game.slug, games, "en")]));
  const byKey = new Map<string, Map<string, EwcClubGame>>();
  const names = new Map<string, string>();
  for (const row of rows) {
    const team = stringValue(row.team);
    if (!team) continue;
    const displayKey = clubKey(team);
    if (displayKey && !names.has(displayKey)) names.set(displayKey, team);
    const game = storedGameForRow(row, gameLabels);
    const gameId = storedGameKey(row);
    if (!game || !gameId) continue;
    for (const key of [...botClubNameKeys(team), ...clubKeys(team)]) {
      if (!key) continue;
      const bucket = byKey.get(key) ?? new Map<string, EwcClubGame>();
      bucket.set(gameId, game);
      byKey.set(key, bucket);
    }
  }
  return { byKey, names: [...names.values()] };
}

function namesFromStoredData(
  standings: RawStanding[],
  storedGameNames: string[],
  wins: Map<string, Map<string, EwcClubWin>>,
) {
  const names = new Map<string, string>();
  for (const row of standings) {
    const name = stringValue(row.team);
    if (name) names.set(clubKey(name), name);
  }
  for (const name of storedGameNames) {
    const key = clubKey(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  for (const key of wins.keys()) {
    if (key && !names.has(key)) names.set(key, key);
  }
  return [...names.values()];
}

export async function getEwcClubTrackerFromDatabase(): Promise<EwcClubTracker> {
  const [snapshot, profiles, storedGames, wins] = await Promise.all([
    latestStoredStandingsRows("2026"),
    teamProfilesByClubKey(),
    storedGamesByClubKey(),
    winsByClubKey(),
  ]);
  const standingsMap = new Map<string, { rank: number | null; points: number | null; eligibility: string | null }>();
  for (const row of snapshot.standings) {
    if (!row.team) continue;
    addLookup(standingsMap, row.team, {
      rank: numberValue(row.rank),
      points: numberValue(row.points),
      eligibility: stringValue(row.eligibility),
    });
  }
  const gamesByClubKey = storedGames.byKey;

  const clubs = namesFromStoredData(snapshot.standings, storedGames.names, wins)
    .map((name): EwcClubTrackerClub | null => {
      const profile = lookupByClubName(profiles, name);
      const region = classifyClubRegion(name, profile);
      const standing = lookupByClubName(standingsMap, name);
      const qualifiedGames = gamesForClub(gamesByClubKey, name);
      const clubWins = winsForClub(wins, name);
      if (!standing && !qualifiedGames.length && !clubWins.length) return null;
      return {
        name,
        pageUrl: null,
        logo: stringValue(profile?.image_url),
        supportProgram: isFeaturedClubName(name),
        featured: isFeaturedClubName(name),
        region,
        regionSource: sourceForRegion(name, profile),
        locationLabel: profile?.location ?? profile?.nationality ?? null,
        rank: standing?.rank ?? null,
        points: standing?.points ?? null,
        eligibility: standing?.eligibility ?? null,
        qualifiedCount: qualifiedGames.length,
        possibleEvents: 0,
        totalTeams: 0,
        games: qualifiedGames,
        qualifiedGames,
        possibleGames: [],
        wins: clubWins,
      };
    })
    .filter((club): club is EwcClubTrackerClub => Boolean(club))
    .sort((a, b) => {
      const points = (b.points ?? -1) - (a.points ?? -1);
      if (points) return points;
      const rank = (a.rank ?? 9999) - (b.rank ?? 9999);
      if (rank) return rank;
      const featured = Number(b.featured) - Number(a.featured);
      if (featured) return featured;
      return a.name.localeCompare(b.name);
    });

  const pointsLeader =
    clubs
      .filter((club) => club.points != null)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (a.rank ?? 9999) - (b.rank ?? 9999))[0] ?? null;

  return {
    sourceUrl: CLUBS_SOURCE_URL,
    standingsSourceUrl: STANDINGS_SOURCE_URL,
    updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
    dataSource: "database-fallback",
    warning: "Live Liquipedia club tracker was unavailable; returned stored local data.",
    clubs,
    summary: {
      total: clubs.length,
      featured: clubs.filter((club) => club.featured).length,
      qualifiedGames: countUniqueQualifiedGames(clubs),
      confirmedWins: clubs.reduce((sum, club) => sum + club.wins.length, 0),
      pointsLeader: pointsLeader
        ? { name: pointsLeader.name, points: pointsLeader.points ?? 0, rank: pointsLeader.rank }
        : null,
    },
  };
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    if (timer && typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sourceForRegion(name: string, profile: (TeamProfileRow & { facts: Record<string, unknown> | null }) | null) {
  if (isFeaturedClubName(name)) return "featured" as const;
  if (profile?.location || profile?.nationality || profile?.facts) return "profile" as const;
  return "unknown" as const;
}

export const getEwcClubTrackerCached = unstable_cache(
  async (): Promise<EwcClubTracker> => {
    const [clubPayload, standings, profiles, wins] = await Promise.all([
      liquipediaFetchers()
        .then(({ fetchEwcClubs }) => fetchEwcClubs())
        .catch(() => ({ sourceUrl: CLUBS_SOURCE_URL, clubs: [] })),
      standingsByClubKey(),
      teamProfilesByClubKey(),
      winsByClubKey(),
    ]);

    const clubs = (clubPayload.clubs ?? [])
      .map((club): EwcClubTrackerClub | null => {
        const name = stringValue(club.name);
        if (!name) return null;
        const profile = lookupByClubName(profiles, name);
        const region = classifyClubRegion(name, profile);
        const standing = lookupByClubName(standings, name);
        const games = (club.games ?? []).map(normalizeGame);
        const qualifiedGames = games.filter((game) => game.status === "qualified");
        const possibleGames = games.filter((game) => game.status === "can_qualify" || game.status === "has_team");
        return {
          name,
          pageUrl: stringValue(club.pageUrl),
          logo: stringValue(club.logo),
          supportProgram: Boolean(club.clubSupportProgram),
          featured: isFeaturedClubName(name),
          region,
          regionSource: sourceForRegion(name, profile),
          locationLabel: profile?.location ?? profile?.nationality ?? null,
          rank: standing?.rank ?? null,
          points: standing?.points ?? null,
          eligibility: standing?.eligibility ?? null,
          qualifiedCount: numberValue(club.qualifiedCount) ?? qualifiedGames.length,
          possibleEvents: numberValue(club.possibleEvents) ?? possibleGames.length,
          totalTeams: numberValue(club.totalTeams) ?? 0,
          games,
          qualifiedGames,
          possibleGames,
          wins: winsForClub(wins, name),
        };
      })
      .filter((club): club is EwcClubTrackerClub => Boolean(club))
      .sort((a, b) => {
        const featured = Number(b.featured) - Number(a.featured);
        if (featured) return featured;
        const points = (b.points ?? -1) - (a.points ?? -1);
        if (points) return points;
        const rank = (a.rank ?? 9999) - (b.rank ?? 9999);
        if (rank) return rank;
        const qualified = b.qualifiedGames.length - a.qualifiedGames.length;
        if (qualified) return qualified;
        return a.name.localeCompare(b.name);
      });

    const pointsLeader =
      clubs
        .filter((club) => club.points != null)
        .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (a.rank ?? 9999) - (b.rank ?? 9999))[0] ?? null;

    return {
      sourceUrl: clubPayload.sourceUrl ?? CLUBS_SOURCE_URL,
      standingsSourceUrl: STANDINGS_SOURCE_URL,
      updatedAt: new Date().toISOString(),
      dataSource: "liquipedia",
      clubs,
      summary: {
        total: clubs.length,
        featured: clubs.filter((club) => club.featured).length,
        qualifiedGames: countUniqueQualifiedGames(clubs),
        confirmedWins: clubs.reduce((sum, club) => sum + club.wins.length, 0),
        pointsLeader: pointsLeader
          ? { name: pointsLeader.name, points: pointsLeader.points ?? 0, rank: pointsLeader.rank }
          : null,
      },
    };
  },
  ["ewc-club-tracker-2026"],
  { revalidate: 900 },
);

export async function getEwcClubTrackerForMcp(timeoutMs = 12_000) {
  try {
    return await timeout(
      getEwcClubTrackerCached(),
      Math.max(1_000, timeoutMs),
      "Timed out while waiting for the live EWC club tracker.",
    );
  } catch (error) {
    const fallback = await getEwcClubTrackerFromDatabase();
    fallback.warning = `${fallback.warning} ${error instanceof Error ? error.message : String(error)}`.trim();
    return fallback;
  }
}

export function filterEwcClubTracker(
  data: EwcClubTracker,
  {
    region = "gulf",
    q = "",
    scope = "featured",
  }: {
    region?: ClubRegionId;
    q?: string;
    scope?: "featured" | "all";
  },
) {
  const query = clubKey(q);
  return data.clubs.filter((club) => {
    if (scope === "featured" && !club.featured) return false;
    if (region !== "all" && club.region !== region) return false;
    if (!query) return true;
    return clubKeys(club.name).some((key) => key.includes(query));
  });
}
