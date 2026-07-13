import "server-only";

import { unstable_cache } from "next/cache";
import { all } from "@bot/db/client.js";
import {
  getEwcClubChampionshipSnapshot,
  getLatestEwcClubChampionshipSnapshot,
} from "@bot/db/ewcClubChampionshipSnapshots.js";
import { clubNameKeys as botClubNameKeys } from "@bot/lib/ewcPredictions.js";
import {
  classifyClubRegion,
  clubKey,
  clubKeys,
  isFeaturedClubName,
  type ClubRegionId,
} from "@/lib/ewc-club-regions";
import { gameTitleForSlug, listGames } from "@/lib/games";

export const DEFAULT_EWC_CLUB_SEASON = String(new Date().getUTCFullYear());
export const EWC_CLUB_SNAPSHOT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const LIVE_FALLBACK_TIMEOUT_MS = 8_000;

function clubsSourceUrl(season: string) {
  return `https://liquipedia.net/esports/Esports_World_Cup/${season}/Clubs`;
}

function standingsSourceUrl(season: string) {
  return `https://liquipedia.net/esports/Esports_World_Cup/${season}/Club_Championship_Standings`;
}

type RawStanding = {
  rank?: number | string | null;
  team?: string | null;
  points?: number | string | null;
  eligibility?: string | null;
  wins?: number | string | null;
  topEightFinishes?: number | string | null;
};

type TeamProfileRow = {
  name: string | null;
  image_url: string | null;
  location: string | null;
  nationality: string | null;
  liquipedia_url: string | null;
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
  hasStanding: boolean;
  qualifiedCount: number;
  possibleEvents: number;
  totalTeams: number;
  games: EwcClubGame[];
  qualifiedGames: EwcClubGame[];
  possibleGames: EwcClubGame[];
  wins: EwcClubWin[];
  winCount: number;
};

export type EwcClubTracker = {
  season: string;
  sourceUrl: string;
  standingsSourceUrl: string;
  updatedAt: string | null;
  dataSource: "stored-snapshot" | "liquipedia-fallback" | "database-fallback";
  stale: boolean;
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

type FetchEwcClubStandings = (year?: number) => Promise<{
  sourceUrl?: string;
  standings?: RawStanding[];
}>;

async function liquipediaFetchers() {
  const mod = (await import("@bot/services/liquipedia.js")) as {
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
    `SELECT name, image_url, location, nationality, liquipedia_url, liquipedia_facts
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

async function winsByClubKey(season: string) {
  const wins = new Map<string, Map<string, EwcClubWin>>();
  const predictionRows = (await all(
    `SELECT results_json
       FROM ewc_prediction_weeks
      WHERE season = $1
        AND results_json IS NOT NULL
        AND TRIM(results_json) <> ''`,
    [season],
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
  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (value: unknown) => {
    const name = stringValue(value);
    if (!name) return;
    const keys = [...new Set([...botClubNameKeys(name), ...clubKeys(name)])].filter(Boolean);
    if (!keys.length || keys.some((key) => seen.has(key))) return;
    names.push(name);
    keys.forEach((key) => seen.add(key));
  };

  // Official standings names are the display authority. Stored game and win
  // aliases can enrich that club, but must not create another visible row.
  for (const row of standings) {
    addName(row.team);
  }
  for (const name of storedGameNames) {
    addName(name);
  }
  for (const key of wins.keys()) {
    addName(key);
  }
  return names;
}

type TrackerBuildInput = {
  season: string;
  standings: RawStanding[];
  standingsSource: string;
  updatedAt: string | null;
  dataSource: EwcClubTracker["dataSource"];
  stale: boolean;
  warning?: string;
};

export function isEwcClubSnapshotStale(
  value: string | null | undefined,
  now = Date.now(),
  staleAfterMs = EWC_CLUB_SNAPSHOT_STALE_AFTER_MS,
) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && now - timestamp > staleAfterMs;
}

async function buildEwcClubTracker(input: TrackerBuildInput): Promise<EwcClubTracker> {
  const [profiles, storedGames, wins] = await Promise.all([
    teamProfilesByClubKey(),
    storedGamesByClubKey(),
    winsByClubKey(input.season),
  ]);
  const standingsMap = new Map<string, { rank: number | null; points: number | null; eligibility: string | null; wins: number | null }>();
  for (const row of input.standings) {
    if (!row.team) continue;
    addLookup(standingsMap, row.team, {
      rank: numberValue(row.rank),
      points: numberValue(row.points),
      eligibility: stringValue(row.eligibility),
      wins: numberValue(row.wins),
    });
  }
  const gamesByClubKey = storedGames.byKey;

  const clubs = namesFromStoredData(input.standings, storedGames.names, wins)
    .map((name): EwcClubTrackerClub | null => {
      const profile = lookupByClubName(profiles, name);
      const region = classifyClubRegion(name, profile);
      const standing = lookupByClubName(standingsMap, name);
      const qualifiedGames = gamesForClub(gamesByClubKey, name);
      const clubWins = winsForClub(wins, name);
      if (!standing && !qualifiedGames.length && !clubWins.length) return null;
      return {
        name,
        pageUrl: stringValue(profile?.liquipedia_url),
        logo: stringValue(profile?.image_url),
        supportProgram: isFeaturedClubName(name),
        featured: isFeaturedClubName(name),
        region,
        regionSource: sourceForRegion(name, profile),
        locationLabel: profile?.location ?? profile?.nationality ?? null,
        rank: standing?.rank ?? null,
        points: standing?.points ?? null,
        eligibility: standing?.eligibility ?? null,
        hasStanding: Boolean(standing),
        qualifiedCount: qualifiedGames.length,
        possibleEvents: 0,
        totalTeams: 0,
        games: qualifiedGames,
        qualifiedGames,
        possibleGames: [],
        wins: clubWins,
        winCount: Math.max(clubWins.length, standing?.wins ?? 0),
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
    season: input.season,
    sourceUrl: clubsSourceUrl(input.season),
    standingsSourceUrl: input.standingsSource,
    updatedAt: input.updatedAt,
    dataSource: input.dataSource,
    stale: input.stale,
    ...(input.warning ? { warning: input.warning } : {}),
    clubs,
    summary: {
      total: clubs.length,
      featured: clubs.filter((club) => club.featured).length,
      qualifiedGames: countUniqueQualifiedGames(clubs),
      confirmedWins: clubs.reduce((sum, club) => sum + club.winCount, 0),
      pointsLeader: pointsLeader
        ? { name: pointsLeader.name, points: pointsLeader.points ?? 0, rank: pointsLeader.rank }
        : null,
    },
  };
}

type StoredClubChampionshipSnapshot = {
  season: string;
  sourceUrl: string;
  standings: RawStanding[];
  fetchedAt: string;
};

export async function getEwcClubTrackerFromDatabase(season?: string): Promise<EwcClubTracker> {
  const snapshot = (season
    ? await getEwcClubChampionshipSnapshot(season)
    : await getLatestEwcClubChampionshipSnapshot()) as StoredClubChampionshipSnapshot | null;
  const trackerSeason = snapshot?.season ?? season ?? DEFAULT_EWC_CLUB_SEASON;
  const stale = !snapshot || isEwcClubSnapshotStale(snapshot.fetchedAt);
  return buildEwcClubTracker({
    season: trackerSeason,
    standings: snapshot?.standings ?? [],
    standingsSource: snapshot?.sourceUrl ?? standingsSourceUrl(trackerSeason),
    updatedAt: snapshot?.fetchedAt ?? null,
    dataSource: snapshot ? "stored-snapshot" : "database-fallback",
    stale,
    warning: snapshot
      ? stale
        ? "Standings are a little older than usual while the next refresh is pending."
        : undefined
      : "No stored Club Championship snapshot is available yet.",
  });
}

// Request handlers that promise stored-only reads (notably MCP) use this
// projection so they never trigger or wait on an external Liquipedia request.
export const getStoredEwcClubTrackerCached = unstable_cache(
  async (season = "") => getEwcClubTrackerFromDatabase(season || undefined),
  ["ewc-club-tracker-stored-only-v1"],
  { revalidate: 60 },
);

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

async function getEwcClubTrackerFromLiveFallback(season: string) {
  const { fetchEwcClubStandings } = await liquipediaFetchers();
  const payload = await fetchEwcClubStandings(Number(season));
  const standings = (payload.standings ?? []).filter((row) => stringValue(row.team));
  if (!standings.length) throw new Error("Live Club Championship standings were empty.");
  return buildEwcClubTracker({
    season,
    standings,
    standingsSource: payload.sourceUrl ?? standingsSourceUrl(season),
    updatedAt: new Date().toISOString(),
    dataSource: "liquipedia-fallback",
    stale: false,
    warning: "No stored snapshot is available yet; showing a timeout-bounded live fallback.",
  });
}

export const getEwcClubTrackerCached = unstable_cache(
  async (): Promise<EwcClubTracker> => {
    const stored = await getEwcClubTrackerFromDatabase();
    if (stored.dataSource === "stored-snapshot") return stored;
    try {
      return await timeout(
        getEwcClubTrackerFromLiveFallback(stored.season),
        LIVE_FALLBACK_TIMEOUT_MS,
        "Timed out while waiting for the Club Championship fallback.",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      stored.warning = `${stored.warning ?? ""} ${detail}`.trim();
      return stored;
    }
  },
  ["ewc-club-tracker-stored-v2"],
  { revalidate: 60 },
);

export async function getEwcClubTrackerForMcp(timeoutMs = 12_000) {
  try {
    return await timeout(
      getEwcClubTrackerCached(),
      Math.max(1_000, timeoutMs),
      "Timed out while waiting for the EWC club tracker.",
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
